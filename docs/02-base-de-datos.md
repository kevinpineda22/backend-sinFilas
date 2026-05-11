# 02 — Base de datos

Sin Filas usa el **mismo proyecto Supabase** que `backend-woocommerce`. Las tablas nuevas llevan prefijo `sf_` para aislar dominios sin duplicar Supabase.

> El script canónico vive en [`06-supabase-setup.sql`](06-supabase-setup.sql). Lo que sigue documenta cada tabla y cómo se usa hoy en el código.

## Tipo enumerado

```sql
CREATE TYPE public.sf_session_state AS ENUM (
  'en_proceso',
  'finalizado',
  'cobrado',
  'cancelado'
);
```

- `en_proceso` — valor por defecto al `INSERT`. Hoy NO se usa: el flujo Lazy Sync crea la sesión ya en `finalizado`.
- `finalizado` — sesión cerrada por el VIP, QR generado.
- `cobrado` — el POS de la caja redimió el QR. (Hoy no hay endpoint que lo escriba todavía.)
- `cancelado` — sesión descartada.

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
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX idx_sf_items_session ON sf_session_items (session_id);
```

**Notas:**

- El nombre real de la tabla es `sf_session_items` (no `sf_items` como decía la doc inicial).
- `codigo_barras` guarda el código que se va a meter al QR. Si es pesable, ya viene en formato GS1 (prefijo `29` + sku + peso + check digit), generado en el frontend con `gs1Utils.js`.
- No se guarda `siesa_codigo` ni `origen` (no hay columna). La fuente del item se conserva implícitamente: si arranca con `29` y mide 13 chars → fue GS1 dinámico (con peso embebido).
- `cantidad` queda `1` para items GS1 con peso embebido (la cantidad ya está en los gramos del propio código).

### `sf_qr_tokens`

Token único por sesión que el POS escanea.

```sql
CREATE TABLE public.sf_qr_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid NOT NULL REFERENCES sf_sessions(id) ON DELETE CASCADE,
  token        text NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX idx_sf_qr_token ON sf_qr_tokens (token);
```

**Notas:**

- La columna que marca "ya cobrado en caja" es `used_at` (NO `redeemed_at`).
- Hoy `token` es un UUID aleatorio (`crypto.randomUUID()`), no un JWT firmado. La caja NO valida firma — lee la string cruda del manifiesto QR que el frontend pinta.
- `expires_at` se inserta como `2099-12-31T23:59:59Z` para mantener compatibilidad con un POS offline a futuro.
- No existe todavía un endpoint que actualice `used_at`: el dashboard la lee pero siempre da `null`.

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

- La tabla EXISTE en BD pero el código todavía no escribe nada acá. Cuando se conecte, usar `details` (jsonb) para el payload del evento.
- Acciones sugeridas cuando se implemente: `session.created`, `session.finalized`, `qr.generated`, `qr.redeemed`, `session.cancelled`.

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

## Diagrama de relaciones

```
profiles ──────────────────┐
 (user_id)                 │
                           │ vip_user_id, user_id
                           ▼
                      sf_sessions ◀──── wc_sedes (sede_id)
                       │   │
                       │   ├──▶ sf_session_items (1:N)
                       │   ├──▶ sf_qr_tokens     (1:1 activo)
                       │   └──▶ sf_audit_log     (1:N — pendiente de implementación)
                       │
                       └──── (productos vienen de items_siesa + siesa_codigos_barras)
```

## Row Level Security (RLS)

**Pendiente.** Las tablas `sf_*` hoy no tienen RLS. El backend usa la `service_role` key (que bypassa RLS), pero si en algún momento el frontend lee directo de Supabase con la `anon` key habrá que definir políticas:

- `sf_sessions`: el VIP solo ve sus propias sesiones; admin ve todas.
- `sf_session_items`: visibles si el usuario tiene acceso a la `session_id`.
- `sf_qr_tokens`: solo lectura por el dueño de la sesión.
- `sf_audit_log`: solo lectura para admin, escritura desde service role.

## Gaps conocidos

- `sf_audit_log` no se escribe desde código todavía.
- `sf_qr_tokens.used_at` nunca se actualiza (falta endpoint que el POS llame al cobrar).
- `sf_sessions.updated_at` no tiene trigger que la mantenga al día.
- `sf_sessions.estado` por defecto es `en_proceso` pero el flujo Lazy Sync inserta directo `finalizado`. Si en algún futuro se hace un flujo "abrir sesión → ir agregando items remotamente", el default ya está en el estado correcto.
