# 09 — Bug: el escáner siempre dice "Producto no encontrado"

> **Estado:** ✅ **FIX APLICADO Y VERIFICADO** (2026-05-25). Verificado contra la BD real
> y con la suite de tests (79 passed). Pendiente solo la prueba final con la cámara física.

## Síntoma

Al escanear un producto con la cámara desde Sin Filas, **siempre** aparece "Producto no
encontrado en el catálogo", incluso con productos que sí existen.

## Qué es el "catálogo" (y sí, está pegado a la BD)

El catálogo vive en Supabase, en dos tablas que el endpoint `GET /api/sf/catalog/search`
une con un JOIN:

| Tabla | Filas | Columnas clave |
|---|---|---|
| `items_siesa` | 22.477 activos | `f120_id` (SKU), `f120_descripcion` (nombre), `activo` |
| `siesa_codigos_barras` | 91.450 | `f120_id` (FK), `codigo_barras`, `unidad_medida` |

Formatos reales de `codigo_barras` observados en la tabla:

- `7702109017103` — EAN-13 puro (lo que lee la cámara).
- `M7702109017103` — variante master/multipack (prefijo `M`).
- `553+` — venta abierta (sufijo `+`), sobre el SKU corto.
- `553UND`, `683P6` — código interno con sufijo de unidad de medida.
- `29xxxxx...` — GS1 corto para pesables (KL, LB, 500GR, 250GR, PZ).

Un mismo producto suele tener **varias** de estas variantes a la vez (ej. `f120_id 553`
tiene 9 códigos distintos).

## Causa raíz

En `src/modules/catalog/catalog.controller.ts` (líneas ~37-51), la rama de búsqueda
numérica no-GS1 arma así el filtro:

```js
const orClauses = [
  `siesa_codigos_barras.codigo_barras.eq.${cleanQuery}`,   // ❌ columna de tabla EMBEBIDA en un .or() raíz
  `siesa_codigos_barras.codigo_barras.eq.${cleanQuery}+`,
];
if (fitsInt4) orClauses.push(`f120_id.eq.${cleanQuery}`);   // ❌ mezcla columna de la tabla RAÍZ
supabaseQuery = supabaseQuery.or(orClauses.join(','));
```

Dos errores:

1. **No se puede referenciar una columna de tabla embebida** (`siesa_codigos_barras.codigo_barras`)
   dentro de un `.or()` a nivel raíz con notación de punto. PostgREST devuelve
   `"failed to parse logic tree"` y la query falla.
2. **Mezcla dos tablas distintas** en el mismo `.or()`: `f120_id` es de `items_siesa`,
   `codigo_barras` es de `siesa_codigos_barras`. Imposible en una sola cláusula.

Como ese error no es de casteo (no es `22P02` / "invalid input syntax"), no entra en el
manejo que devuelve `[]`, sino en el `500` genérico → el frontend lo muestra como
"producto no encontrado".

El caso **GS1 pesable** (prefijo `29`, usa `.like()`) **sí funciona** y no se toca.
El único roto es el `.or()` del escaneo normal — el caso más frecuente.

## Evidencia (verificada contra Supabase real)

| Código | ¿Existe en la BD? | Query actual del controller | Query directa `.eq` embebida |
|---|---|---|---|
| `7702109017103` (ACEITE OLEOSABOR) | ✅ | ❌ `failed to parse logic tree`, 0 | ✅ 1 resultado |
| `7702129005173` (LECHE COLANTA) | ✅ | ❌ `failed to parse logic tree`, 0 | ✅ 1 resultado |
| `7704277010498` | ✅ | ❌ `failed to parse logic tree`, 0 | ✅ 1 resultado |

## Fix propuesto (enfoque de 2 pasos, ya probado contra la BD)

Respeta el comentario de diseño del propio controller: *"en búsqueda numérica dejamos todo
para que el frontend haga match exacto"*. Y cumple el requisito: el escáner manda solo el
código de barras (sin UND/P2/P4) y se buscan todas las variantes sin depender de la unidad.

**Paso 1** — resolver `f120_id` buscando en `siesa_codigos_barras` con un `.or()` sobre
columnas de la **misma** tabla (sin embeber):

```js
const fitsInt4 = cleanQuery.length <= 9 && Number(cleanQuery) <= 2147483647;
const orClauses = [
  `codigo_barras.eq.${cleanQuery}`,
  `codigo_barras.eq.${cleanQuery}+`,
  `codigo_barras.eq.M${cleanQuery}`,
];
if (fitsInt4) orClauses.push(`f120_id.eq.${cleanQuery}`);

const { data: hits, error: hitErr } = await supabaseAdmin
  .from('siesa_codigos_barras')
  .select('f120_id')
  .or(orClauses.join(','))
  .limit(200);

const ids = [...new Set((hits ?? []).map((h) => h.f120_id))];
if (ids.length === 0) { res.json([]); return; }   // realmente no existe → []
```

**Paso 2** — traer esos productos con **todas** sus presentaciones (sin `!inner`):

```js
const { data, error } = await supabaseAdmin
  .from('items_siesa')
  .select('f120_id, f120_descripcion, siesa_codigos_barras(codigo_barras, unidad_medida)')
  .eq('activo', true)
  .in('f120_id', ids)
  .limit(50);
```

El resto del controller (agrupación por `f120_id`, armado de `presentaciones`, filtro de
búsqueda por texto, respuesta) queda igual. La rama GS1 (`like`) y la de texto (`ilike`)
no se modifican.

## Pasos pendientes para retomar

- [x] Aplicar el fix de 2 pasos en `catalog.controller.ts` (solo la rama numérica no-GS1).
- [x] Manejo de error del Paso 1: `hitErr` → 500; paso 1 vacío → `[]` con 200.
- [x] Tests del controller actualizados al flujo de 2 pasos + casos nuevos (no existe → `[]`,
      lookup falla → 500). Mock `supabaseMock.ts` ahora soporta `.in()`. **79 tests passed.**
- [ ] Confirmar con el frontend qué hace ante `[]` vs `500` (hoy ambos se ven como
      "no encontrado"); idealmente distinguir "no existe" de "error de conexión".
- [ ] **Probar end-to-end con la cámara física** usando los 3 códigos de la tabla de evidencia.
- [ ] (Opcional) Evaluar si conviene también buscar variantes con sufijo de unidad
      (`XUND`, `XP6`) para SKUs cortos tipeados a mano.
- [ ] Quitar este documento una vez confirmado en cámara.

## Cómo re-verificar rápido

Script de diagnóstico (correr con `node`, usa el `.env` vía dotenv):

```js
require('dotenv/config');
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
(async () => {
  const code = '7702109017103';
  const { data: hits } = await sb.from('siesa_codigos_barras')
    .select('f120_id')
    .or(`codigo_barras.eq.${code},codigo_barras.eq.${code}+,codigo_barras.eq.M${code}`);
  const ids = [...new Set((hits ?? []).map((h) => h.f120_id))];
  const { data } = await sb.from('items_siesa')
    .select('f120_id, f120_descripcion, siesa_codigos_barras(codigo_barras, unidad_medida)')
    .eq('activo', true).in('f120_id', ids);
  console.log(JSON.stringify(data, null, 2));
})();
```
