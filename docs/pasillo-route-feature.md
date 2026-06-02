# Feature: Ruta de pasillos del cliente VIP (Sin Filas)

> Documento técnico de referencia. Sirve para retomar el trabajo sin perder contexto.
> Última actualización: 2026-06-02 (mapa interactivo v2).

## 0. PUNTO DE RETOMA (leer primero)

**Estado del feature base (ruta de pasillos):** DESPLEGADO. El backend SF (fases 2/3) ya está
commiteado y pusheado a Vercel; el catálogo/cache `sf_producto_pasillos` está poblado.

**Lo nuevo (mapa interactivo v2 — recién codeado, sin desplegar):** plano 2D de la tienda con
reactflow. El recorrido de cada sesión se reproduce animado (play/pausa/scrub) sobre el plano, y
hay un EDITOR en el admin para acomodar los pasillos al plano real de cada sede y persistirlo.

### Pasos manuales pendientes para v2 (en orden)

1. **Migración DB:** correr `docs/sql/sede-layout.sql` en Supabase (crea `sf_sede_pasillos` y
   `sf_sede_layout`).
2. **Re-correr el sync** en `backend-woocommerce` (ahora lee de **`items_siesa`**, ya no de Woo):
   - Primero MEDIR: `node tools/syncPasilloCache.js --dry` → reporta por sede el % de
     productos que cae en un pasillo real vs "Otros". Si "Otros" es bajo, seguí.
   - Poblar: `node tools/syncPasilloCache.js` → llena `sf_producto_pasillos` (pasillo por
     producto/sede) **y** `sf_sede_pasillos` (catálogo id+nombre+orden, que necesita el editor).
   Sin esto último el editor de mapa sale vacío.
3. **Deploy backend SF** (Vercel) — endpoints nuevos `GET/PUT /admin/sede-layout`.
4. **Deploy frontend** — visor + editor.
5. **Armar el plano de cada sede:** en el panel admin → "Mapa de la tienda", elegí una sede,
   arrastrá los pasillos a su lugar real, agregá entrada y caja, y Guardar. Repetir por sede.
6. **Verificar:** abrir el detalle de una sesión con varios pasillos → "Ruta del cliente" →
   reproducir la animación del recorrido sobre el plano.

### Archivos del v2 (para commitear)

`Backend-sinFilas`:
```
 M src/modules/admin/admin.controller.ts   (getSedeLayout, saveSedeLayout)
 M src/modules/admin/admin.route.ts
?? docs/sql/sede-layout.sql
 M docs/pasillo-route-feature.md
```
`backend-woocommerce`:
```
 M tools/syncPasilloCache.js   (lee items_siesa + seedSedePasillos + modo --dry)
 M tools/mapeadorPasillos.js   (keywords dulceria/confiteria/gomitas/caramelo)
```
`Pagina-web_React`:
```
?? src/pages/sinFilas/utils/storeMapLayout.js
?? src/pages/sinFilas/components/SFMapNodes.jsx
?? src/pages/sinFilas/views/admin/SFRouteMap.jsx
?? src/pages/sinFilas/views/admin/SFStoreMapEditor.jsx
?? src/pages/sinFilas/views/admin/SFStoreMap.css
 M src/pages/sinFilas/views/admin/SFSessionDetailModal.jsx
 M src/pages/sinFilas/views/SFAdminDashboard.jsx
 M src/pages/sinFilas/api/sfApi.js
```

**Pendiente opcional:** backfill de sesiones viejas; mapa de calor agregado (Inteligencia) sobre el
mismo plano 2D (hoy sigue siendo barra horizontal).

---

## 1. Objetivo

En el panel admin de Sin Filas (zona **Inteligencia** + **detalle de sesión**), visualizar:

- La **ruta** que recorrió el cliente VIP por los pasillos del supermercado (orden cronológico, con idas y vueltas).
- **Cuántos productos** tomó por pasillo.
- A nivel agregado: un **mapa de calor** de qué pasillos son los más transitados.

## 2. Restricciones de datos (verificadas en código)

Esto define toda la arquitectura. NO asumir lo contrario.

| Hecho | Implicancia |
|---|---|
| `sf_session_items` guarda solo `codigo_barras, nombre_producto, cantidad, unidad_medida` | No hay categoría ni orden por ítem hoy |
| ~~El catálogo SF NO tiene categorías~~ → **`items_siesa` SÍ tiene `grupo` + `subgrupo`** (taxonomía SIESA, diaria) | **Fuente de categorías actual.** Ver nota de migración abajo |
| ~~Las categorías SOLO existen en WooCommerce~~ (superado) | Woo era un espejo; SIESA es el ERP origen. Se dejó de depender de la API de Woo |
| El carrito **fusiona por código de barras** | Es un conjunto, no un timeline. El orden de inserción ≈ orden del primer escaneo de cada producto distinto. Es el mejor proxy de "ruta" que tenemos |
| `mapeadorPasillos.js` (backend-woocommerce) ya resuelve categoría→pasillo por sede | Reutilizamos esa lógica tal cual, no la reescribimos |

> **Migración de fuente de categorías (2026-06-02):** se pasó de WooCommerce a **`items_siesa.grupo` +
> `items_siesa.subgrupo`**. Motivo: SIESA es el ERP origen (diario), cubre TODOS los productos —no solo
> los publicados en Woo— y elimina la dependencia de la API de Woo (sin paginación ni jerarquía de
> categorías). Se verificó que la taxonomía SIESA matchea casi 1:1 las keywords del `mapeadorPasillos`
> (DESODORANTE→cuidado_personal, YOGURT→lácteos, CAFE→café, etc.). `mapeadorPasillos` NO se reescribió:
> sigue siendo el motor categoría→pasillo por sede; solo se le dan `grupo`+`subgrupo` como categorías y
> se le agregó un puñado de keywords (`dulceria`, `confiteria`, `gomitas`, `caramelo`). Productos con
> grupo/subgrupo en null caen al match por `f120_descripcion` (fallback que ya existía).

## 3. Arquitectura elegida

**Decisión 1 (usuario):** hacerlo bien — cambio de backend + migración, no MVP por nombre.
**Decisión 2 (usuario):** tabla cache sincronizada desde Woo.
**Decisión 3 (implementador):** la cache guarda el **pasillo ya resuelto por (producto, sede)**, no el bucket de categoría. Así toda la lógica de pasillos/categorías queda en un único lugar (backend de Woo, ya testeado) y Sin Filas solo hace lookup. Sin duplicar `SEDES_CONFIG`.

### Flujo de datos

```
SYNC (offline, en backend-woocommerce, on-demand/cron)
  Leer items_siesa (activos): { f120_id, f120_descripcion, grupo, subgrupo }  [paginado de a 1000]
  Para cada sede activa (wc_sedes):
    seed sf_sede_pasillos (catálogo id+nombre+orden desde SEDES_CONFIG)
    Para cada producto de items_siesa:
      categorias = [grupo, subgrupo] (como pseudo-categorías)
      { pasillo, prioridad } = obtenerInfoPasillo(categorias, f120_descripcion, sede.slug)
      upsert sf_producto_pasillos (f120_id, sede_slug, pasillo, pasillo_orden=prioridad, nombre_producto)
  (Ya NO se usa la API de WooCommerce. `node tools/syncPasilloCache.js --dry` mide cobertura sin escribir.)

CHECKOUT (en Backend-sinFilas, en vivo, rápido)
  createDirectCheckout:
    sede_slug = lookup wc_sedes by req.sedeId           (cacheable)
    f120_ids  = lookup siesa_codigos_barras by codigo_barras de cada ítem
    pasillos  = lookup sf_producto_pasillos by (f120_id, sede_slug)
    insert sf_session_items con: posicion (índice en el array), pasillo, pasillo_orden

LECTURA (en Backend-sinFilas)
  getSessionDetail → items ordenados por posicion, con pasillo/pasillo_orden
  getAnalytics     → agregado de ítems por pasillo en el período (ordenado por pasillo_orden)

VISUAL (frontend React)
  SFSessionDetailModal → "Ruta del cliente": secuencia de pasillos por posicion + conteo
  SFIntelligenceView   → mapa de calor de pasillos
```

## 4. Esquema de datos (SQL para Supabase)

Ver `docs/sql/pasillo-route.sql`. Resumen:

```sql
-- Cache producto→pasillo por sede (poblada por el sync)
create table if not exists sf_producto_pasillos (
  f120_id         integer     not null,
  sede_slug       text        not null,
  pasillo         text        not null,
  pasillo_orden   integer     not null,
  nombre_producto text,
  updated_at      timestamptz not null default now(),
  primary key (f120_id, sede_slug)
);
create index if not exists idx_sf_producto_pasillos_sede on sf_producto_pasillos (sede_slug);

-- Datos de ruta por ítem (poblados al checkout)
alter table sf_session_items
  add column if not exists posicion      integer,
  add column if not exists pasillo        text,
  add column if not exists pasillo_orden  integer;
```

> Se evita el nombre `position` (palabra reservada confusa en Postgres) → se usa `posicion`.
> Columnas nullable: las sesiones viejas quedan en null (sin ruta) hasta un backfill opcional.

## 5. Componentes por fase

### Fase 0 — Migración DB  ·  responsable: **USUARIO** (corre el SQL)
- Correr `docs/sql/pasillo-route.sql` en el SQL Editor de Supabase.

### Fase 1 — Sincronizador  ·  responsable: **Claude** (código) + **Usuario** (correr)
- `backend-woocommerce/tools/syncPasilloCache.js`. Lee **`items_siesa`** (no Woo) + `obtenerInfoPasillo` + `supabase`.
- Vuelca también el catálogo `sf_sede_pasillos` (vía `seedSedePasillos`, desde `SEDES_CONFIG`).
- Medir antes: `node tools/syncPasilloCache.js --dry`. Poblar: `node tools/syncPasilloCache.js`.

### Fase 2 — Resolver pasillo al checkout  ·  responsable: **Claude**
- `Backend-sinFilas/src/modules/sessions/sessions.controller.ts` → `createDirectCheckout`.
- Lookup `wc_sedes` (sede_id→slug), `siesa_codigos_barras` (codigo_barras→f120_id), `sf_producto_pasillos` (→pasillo).
- Guardar `posicion`, `pasillo`, `pasillo_orden` por ítem.

### Fase 3 — Exponer datos  ·  responsable: **Claude**
- `admin.controller.ts`:
  - `getSessionDetail`: incluir `posicion, pasillo, pasillo_orden`, `order by posicion`.
  - `getAnalytics`: agregar bloque `pasillos` (conteo de ítems por pasillo en el período).

### Fase 4 — Visualización  ·  responsable: **Claude**
- `SFSessionDetailModal.jsx`: sección "Ruta del cliente".
- `SFIntelligenceView.jsx`: mapa de calor de pasillos.

## 6. Qué tenés que hacer VOS (manual)

1. **Correr la migración** (`docs/sql/pasillo-route.sql`) en Supabase SQL Editor. *(Fase 0)*
2. **Verificar los slugs**: los slugs en `wc_sedes.slug` deben coincidir EXACTO con las keys de `SEDES_CONFIG` en `mapeadorPasillos.js`: `copacabana-plaza`, `girardota`, `barbosa`, `villahermosa`. Si no coinciden, el mapeador cae al default (copacabana) en silencio. Query de chequeo en el SQL.
3. **Correr el sync** una vez listo: `node tools/syncPasilloCache.js` en `backend-woocommerce`.
4. **Deploy** del backend SF (Vercel) y del frontend tras los cambios de código.
5. (Opcional, después) Programar el sync como cron.

## 7. Gotchas / decisiones

- `obtenerInfoPasillo(categoriasWC, nombre, sedeSlug)` devuelve `{ pasillo, prioridad }`. `pasillo_orden = prioridad`.
- Slugs que no matchean SEDES_CONFIG → fallback a `SEDE_DEFAULT` ("copacabana-plaza") sin error. Verificar (punto 6.2).
- `posicion` = orden de primer escaneo de cada producto distinto (el carrito fusiona por código). No es un timeline exacto, pero es el recorrido real disponible.
- Productos sin match → `pasillo = "Otros"`, `pasillo_orden = 99`.
- La ruta solo existe para sesiones creadas DESPUÉS de desplegar la Fase 2. Backfill opcional (sin `posicion` fiable).

## 8. Estado de avance (checklist)

- [ ] Fase 0 — Migración DB (**usuario** corre `docs/sql/pasillo-route.sql`)
- [x] Fase 1 — `syncPasilloCache.js` escrito (`backend-woocommerce/tools/`)
- [x] Fase 1 — sync corrido y cache poblada (4 sedes × 11.025 = 44.100 filas; 2026-06-01)
- [x] Fase 0 — SQL corrido en Supabase
- [x] Verificación slugs — los 4 slugs coinciden con SEDES_CONFIG
- [x] Fase 2 — checkout guarda pasillo+posicion (`sessions.controller.ts` + `sessions.schemas.ts` con `f120_id`)
- [x] Fase 3 — detail + analytics exponen pasillos (`admin.controller.ts`)
- [x] Fase 4 — visualización detalle "Ruta del cliente" (`SFSessionDetailModal.jsx/.css`)
- [x] Fase 4 — visualización inteligencia "Mapa de calor de pasillos" (`SFIntelligenceView.jsx`)
- [ ] Verificación slugs wc_sedes vs SEDES_CONFIG (**usuario**: ver query 3 del SQL)
- [ ] Deploy backend SF (Vercel) + frontend

### Orden de ejecución correcto
1. Fase 0 (SQL) — crea las columnas/tabla.
2. Deploy backend SF (Fase 2/3 ya en código) — empieza a guardar pasillos en checkouts nuevos.
3. Fase 1 sync (poblar cache) — idealmente ANTES o junto al deploy, así los checkouts ya encuentran pasillo.
4. Deploy frontend (Fase 4).
5. Las rutas aparecen en sesiones creadas DESPUÉS de (2)+(3).
```

## 9. Mapa interactivo de la tienda (v2)

Convierte la "ruta del cliente" (lista de paradas) en un **plano 2D interactivo** y agrega un
editor de layout por sede. Motor: **reactflow v11** (ya instalado, junto con `dagre`,
`framer-motion`, `konva`). No se sumaron dependencias.

### Por qué hace falta un editor

`mapeadorPasillos.js` NO tiene coordenadas físicas: solo un `orden_ruta` (orden lineal de
recorrido). Para dibujar un plano fiel a la tienda real, alguien tiene que ubicar cada pasillo una
vez. En vez de hardcodear coordenadas, el admin las construye arrastrando en un editor y se
persisten. El layout auto (serpentina desde `orden_ruta`) es solo el punto de partida.

### Datos (2 tablas nuevas — `docs/sql/sede-layout.sql`)

- `sf_sede_pasillos (sede_slug, pasillo, nombre, pasillo_orden)` — **catálogo** de pasillos por
  sede. Fuente de verdad: `SEDES_CONFIG`. Lo puebla el sync (`seedSedePasillos`).
- `sf_sede_layout (sede_slug, nodo_id, tipo, etiqueta, x, y, ancho, alto)` — **posiciones** del
  editor. `tipo` ∈ {pasillo, entrada, caja}. `nodo_id` = id de pasillo o `__entrada__`/`__caja__`.

### Endpoints (Backend-sinFilas, `admin.controller.ts`)

- `GET /admin/sede-layout[?sede_id=UUID]` → `{ sede_slug, catalogo[], nodos[] }`. El visor pasa
  `sede_id` (la sede de la sesión); el editor usa la sede activa del header `X-Sede-ID`.
- `PUT /admin/sede-layout` → guarda el layout completo de la sede activa (upsert + borra obsoletos).

### Frontend (`Pagina-web_React/src/pages/sinFilas`)

- `utils/storeMapLayout.js` — serpentina, colapso de paradas (`buildStops`), merge catálogo+posiciones.
- `components/SFMapNodes.jsx` — nodos custom de reactflow (pasillo / entrada / caja).
- `views/admin/SFRouteMap.jsx` — **visor**: reproduce el recorrido de una sesión (play/pausa/scrub),
  resalta pasillo activo, badge de orden de visita, tinte de calor por ítems. Vive en el modal de
  detalle de sesión.
- `views/admin/SFStoreMapEditor.jsx` — **editor**: arrastrar pasillos + entrada/caja, auto-acomodar,
  guardar. Nueva pestaña "Mapa de la tienda" en el panel admin.

### Gotchas

- El visor usa `useNodesState/useEdgesState` y solo PARCHEA `data` por step: así reactflow conserva
  el tamaño medido de los nodos y las flechas no se descolocan.
- Pasillos "Sin clasificar"/"Otros" sin nodo en el catálogo se omiten del trazo (se muestra el conteo).
- Editor requiere una sede CONCRETA (no "todas"); con "todas" devuelve 400 `missing-sede`.
