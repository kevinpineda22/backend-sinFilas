# Feature: Ruta de pasillos del cliente VIP (Sin Filas)

> Documento técnico de referencia. Sirve para retomar el trabajo sin perder contexto.
> Última actualización: 2026-06-01.

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
| El catálogo SF (`items_siesa` / `siesa_codigos_barras`) NO tiene categorías | No se puede mapear pasillo desde SF con datos propios |
| Las categorías SOLO existen en **WooCommerce** (API en vivo) | Hay que traerlas vía Woo; puente `sku de Woo = f120_id de SIESA` |
| El carrito **fusiona por código de barras** | Es un conjunto, no un timeline. El orden de inserción ≈ orden del primer escaneo de cada producto distinto. Es el mejor proxy de "ruta" que tenemos |
| `mapeadorPasillos.js` (backend-woocommerce) ya resuelve categoría→pasillo por sede | Reutilizamos esa lógica tal cual, no la reescribimos |

## 3. Arquitectura elegida

**Decisión 1 (usuario):** hacerlo bien — cambio de backend + migración, no MVP por nombre.
**Decisión 2 (usuario):** tabla cache sincronizada desde Woo.
**Decisión 3 (implementador):** la cache guarda el **pasillo ya resuelto por (producto, sede)**, no el bucket de categoría. Así toda la lógica de pasillos/categorías queda en un único lugar (backend de Woo, ya testeado) y Sin Filas solo hace lookup. Sin duplicar `SEDES_CONFIG`.

### Flujo de datos

```
SYNC (offline, en backend-woocommerce, on-demand/cron)
  Para cada sede activa (wc_sedes):
    getWooClient(sede_id) → GET products (id, sku, name, categories) [paginado]
                          → GET products/categories (id, name, parent) [jerarquía]
    Para cada producto:
      f120_id = parseInt(sku)
      { pasillo, prioridad } = obtenerInfoPasillo(categorias, name, sede.slug)
      upsert sf_producto_pasillos (f120_id, sede_slug, pasillo, pasillo_orden=prioridad, nombre_producto)

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
- `backend-woocommerce/tools/syncPasilloCache.js` (nuevo). Reusa `getWooClient`, `obtenerInfoPasillo`, `supabase`.
- No requiere refactor de `mapeadorPasillos.js`.
- Correr: `node tools/syncPasilloCache.js` (con el `.env` del backend-woocommerce).

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
