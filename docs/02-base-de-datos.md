# 02 — Base de datos

Sin Filas usa el **mismo proyecto Supabase** que `backend-woocommerce`. Las tablas nuevas llevan prefijo `sf_` para aislar dominios sin duplicar Supabase.

> El script canónico vive en [`06-supabase-setup.sql`](06-supabase-setup.sql). Lo que sigue documenta cada tabla y cómo se usa hoy en el código.

## Tipo enumerado

`sf_sessions.estado` es de tipo `public.sf_session_state`. **Valores que el código usa hoy:**

- `en_proceso` — valor por defecto al `INSERT`. Hoy NO se escribe explícitamente: el flujo Lazy Sync crea la sesión ya en `completada`.
- `completada` — sesión cerrada por el VIP, QR generado. Es el único estado que escribe el checkout (`createDirectCheckout`), y uno de los dos que acepta el filtro del panel admin (`ESTADOS = ['en_proceso', 'completada']`).

> **Nota de drift:** versiones viejas de esta doc listaban `finalizado`, `cobrado` y `cancelado`. El código actual NO escribe ninguno de esos; el flujo de cobro lo gestiona el POS externo. Si tu definición del tipo todavía los incluye, son valores legacy inertes (Postgres no permite `DROP VALUE` directo — ver [`08-migration-remove-cobros.sql`](08-migration-remove-cobros.sql)).

## Tablas

### `sf_sessions`

Cabecera del carrito de un cliente VIP.

```sql
CREATE TABLE public.sf_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vip_user_id  uuid NOT NULL REFERENCES profiles(user_id) ON DELETE RESTRICT,
  sede_id      uuid NOT NULL REFERENCES wc_sedes(id)      ON DELETE RESTRICT,
  estado       sf_session_state NOT NULL DEFAULT 'en_proceso',
  total_items  numeric NOT NULL DEFAULT 0,
  total_precio numeric(12,2) DEFAULT 0,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

CREATE INDEX idx_sf_sessions_vip    ON sf_sessions (vip_user_id);
CREATE INDEX idx_sf_sessions_sede   ON sf_sessions (sede_id);
CREATE INDEX idx_sf_sessions_estado ON sf_sessions (estado);
```

**Notas:**

- `vip_user_id` referencia `profiles.user_id` (NO `profiles.id`).
- `total_items` se guarda como conteo simple de líneas (`items.length` desde el controller).
- `total_precio` = `Σ(precio_unitario × cantidad)` de los ítems. Lo calcula el **backend** en el checkout (no confía en el total que manda el frontend) → única fuente de verdad.
- `updated_at` no se actualiza solo: no hay trigger configurado todavía.

### `sf_session_items`

Items escaneados/pesados dentro de una sesión.

```sql
CREATE TABLE public.sf_session_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       uuid NOT NULL REFERENCES sf_sessions(id) ON DELETE CASCADE,
  codigo_barras    text NOT NULL,
  nombre_producto  text,
  cantidad         numeric NOT NULL DEFAULT 1,
  unidad_medida    text DEFAULT 'UND',
  posicion         integer,
  pasillo          text,
  pasillo_orden    integer,
  f120_id          integer,
  precio_unitario  numeric(12,2) DEFAULT 0,
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX idx_sf_items_session ON sf_session_items (session_id);
CREATE INDEX idx_sf_items_f120    ON sf_session_items (f120_id);
```

**Notas:**

- El nombre real de la tabla es `sf_session_items` (no `sf_items` como decía la doc inicial).
- `codigo_barras` guarda el código que se va a meter al QR. Si es pesable, ya viene en formato GS1 (prefijo `29` + sku + peso + check digit), generado en el frontend con `gs1Utils.js`.
- `f120_id` — SKU SIESA del producto. Permite resolver el pasillo (cache `sf_producto_pasillos`) y reconstruir la imagen desde Woo al reabrir la sesión. La fuente del item se conserva implícitamente: si el código arranca con `29` y mide 13 chars → fue GS1 dinámico (con peso embebido).
- `posicion` — orden de escaneo (0-based). Se usa para reconstruir el recorrido del cliente en el mapa de la tienda.
- `pasillo` / `pasillo_orden` — resueltos en el checkout desde `sf_producto_pasillos` (best-effort; `null` si el producto no está mapeado en esa sede).
- `precio_unitario` — precio de lista por sede que el carrito resolvió contra SIESA al escanear. Si el producto no tiene precio en la lista, queda en 0.
- `cantidad` queda `1` para items GS1 con peso embebido (la cantidad ya está en los gramos del propio código).

### `sf_audit_log`

Bitácora de eventos.

```sql
CREATE TABLE public.sf_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid REFERENCES sf_sessions(id) ON DELETE SET NULL,
  user_id     uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  action      text NOT NULL,
  details     jsonb DEFAULT '{}'::jsonb,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX idx_sf_audit_session ON sf_audit_log (session_id);
```

**Notas:**

- `logAudit` (en `src/shared/audit/auditWriter.ts`) ya escribe acá. Es fire-and-forget: nunca rompe la operación principal.
- Acciones implementadas hoy: `session.finalized`, `session.rollback`, `session.deleted`.
- `session.deleted` se escribe al borrar una sesión desde el panel admin. Como la sesión ya no existe, va con `session_id = NULL` y el id eliminado queda en `details.deleted_session_id` (junto con `total_items`, `total_precio` y `vip_user_id` para trazabilidad).
- Pendiente de implementar: `session.cancelled`, `session.created` (este último solo aplicaría si en el futuro hubiera flujo `en_proceso`).

## Tablas existentes que reusamos

### `profiles`

Usuarios de Supabase Auth. El PK lógico que usamos es `user_id`.

| Columna | Uso en Sin Filas |
|---|---|
| `user_id` | FK desde `sf_sessions.vip_user_id` y `sf_audit_log.user_id` |
| `nombre`  | Mostrado en el dashboard admin |
| `correo`  | Mostrado en el dashboard admin |
| `role`    | Rol del usuario; cualquier empleado puede usar Sin Filas, no se filtra |

### `wc_sedes`

Sede donde opera la sesión. Se usa `id` como FK desde `sf_sessions.sede_id`.

### `items_siesa` + `siesa_codigos_barras`

Catálogo de productos. El módulo `catalog/search` hace un join:

```ts
supabaseAdmin
  .from('items_siesa')
  .select('f120_id, f120_descripcion, siesa_codigos_barras!inner(codigo_barras, unidad_medida)')
  .eq('activo', true)
```

Columnas relevantes:

| Tabla | Columna | Uso |
|---|---|---|
| `items_siesa` | `f120_id` | SKU numérico (clave del producto) |
| `items_siesa` | `f120_descripcion` | Nombre mostrado en el frontend |
| `items_siesa` | `activo` | Filtro: sólo productos activos |
| `siesa_codigos_barras` | `codigo_barras` | EAN/GS1 buscado al escanear |
| `siesa_codigos_barras` | `unidad_medida` | KL, LB, 500GR, 250GR, PZ, UND, P6... |

### `role_permissions`

Matriz de rutas habilitadas por rol. Ver [`07-roles-setup.sql`](07-roles-setup.sql) para los inserts de `sf_vip` y `sf_admin`.

### `sf_qr_tokens` (existe en BD, hoy sin uso desde el backend)

```sql
CREATE TABLE public.sf_qr_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES sf_sessions(id) ON DELETE CASCADE,
  token       text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz DEFAULT now()
);
```

La tabla **sigue existiendo** en el esquema, pero el backend actual **no la lee ni la escribe**: el QR se arma y se reconstruye en el frontend a partir de `sf_session_items`. La FK `ON DELETE CASCADE` es relevante para el borrado de sesiones (al eliminar una sesión, sus tokens caen solos).

### Tablas del mapa de la tienda (pasillos y layout)

`sf_producto_pasillos`, `sf_sede_pasillos` y `sf_sede_layout` soportan la resolución de pasillos y el plano 2D por sede. Su DDL y uso están documentados en [`pasillo-route-feature.md`](pasillo-route-feature.md) y los scripts [`sql/pasillo-route.sql`](sql/pasillo-route.sql) / [`sql/sede-layout.sql`](sql/sede-layout.sql).

## Diagrama de relaciones

```
profiles ──────────────────┐
 (user_id)                 │
                           │ vip_user_id, user_id
                           ▼
                      sf_sessions ◀──── wc_sedes (sede_id)
                       │   │
                       │   ├──▶ sf_session_items (1:N)
                       │   └──▶ sf_audit_log     (1:N — conectado)
                       │
                       └──── (productos vienen de items_siesa + siesa_codigos_barras)
```

## Row Level Security (RLS)

**Pendiente.** Las tablas `sf_*` hoy no tienen RLS. El backend usa la `service_role` key (que bypassa RLS), pero si en algún momento el frontend lee directo de Supabase con la `anon` key habrá que definir políticas:

- `sf_sessions`: el VIP solo ve sus propias sesiones; admin ve todas.
- `sf_session_items`: visibles si el usuario tiene acceso a la `session_id`.
- `sf_audit_log`: solo lectura para admin, escritura desde service role.

## Gaps conocidos

- `sf_sessions.updated_at` no tiene trigger que la mantenga al día (hoy nunca se actualiza desde el código).
- `sf_sessions.estado` por defecto es `en_proceso` pero el flujo Lazy Sync inserta directo `completada`. Si en algún futuro se hace un flujo "abrir sesión → ir agregando items remotamente", el default ya está en el estado correcto.
- No existe endpoint para mover una sesión a `cancelado` desde el panel; hoy solo puede setearse manualmente en BD.

## Inactivo / legacy

- **Tabla `sf_qr_tokens`** — existe en el esquema pero el backend ya no la usa (ver sección arriba). El manifiesto QR se reconstruye localmente desde `sf_session_items` al reabrir una sesión del historial.
- **Valores legacy del enum `sf_session_state`** (`finalizado`, `cobrado`, `cancelado`) — si tu definición del tipo todavía los incluye, quedan por compatibilidad histórica (Postgres no permite `DROP VALUE`), pero el backend nunca los escribe. Hoy solo se usan `en_proceso` (default) y `completada`.
