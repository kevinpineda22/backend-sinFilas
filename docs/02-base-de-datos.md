# 02 — Base de datos

Sin Filas usa el **mismo proyecto Supabase** que `backend-woocommerce`. Las tablas nuevas llevan prefijo `sf_` para aislar dominios sin duplicar Supabase.

## Tablas nuevas

### `sf_sessions`

Una sesión = un carrito de un cliente que un VIP está procesando.

```sql
CREATE TABLE sf_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vip_user_id     UUID NOT NULL REFERENCES profiles(id),
  sede_id         UUID NOT NULL REFERENCES wc_sedes(id),
  estado          TEXT NOT NULL DEFAULT 'abierta'
                  CHECK (estado IN ('abierta','finalizada','cobrada','cancelada')),
  total_items     INTEGER NOT NULL DEFAULT 0,
  cliente_nota    TEXT,                              -- nombre/referencia opcional del cliente
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalized_at    TIMESTAMPTZ,
  redeemed_at     TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,
  CONSTRAINT sf_sessions_estado_consistencia CHECK (
    (estado = 'abierta'     AND finalized_at IS NULL AND redeemed_at IS NULL AND cancelled_at IS NULL) OR
    (estado = 'finalizada'  AND finalized_at IS NOT NULL AND redeemed_at IS NULL AND cancelled_at IS NULL) OR
    (estado = 'cobrada'     AND finalized_at IS NOT NULL AND redeemed_at IS NOT NULL AND cancelled_at IS NULL) OR
    (estado = 'cancelada'   AND cancelled_at IS NOT NULL)
  )
);

CREATE INDEX idx_sf_sessions_vip_estado ON sf_sessions (vip_user_id, estado);
CREATE INDEX idx_sf_sessions_sede_estado ON sf_sessions (sede_id, estado);
CREATE INDEX idx_sf_sessions_created_at ON sf_sessions (created_at DESC);
```

**Reglas de negocio:**

- Un VIP puede tener **una sola sesión `abierta` por sede** (regla aplicada en service, no en DB, para flexibilidad).
- Las transiciones de estado son one-way: `abierta → finalizada → cobrada` o `abierta → cancelada`.
- Una sesión `finalizada` no se puede modificar (no se agregan/quitan items).

### `sf_items`

Items dentro de una sesión.

```sql
CREATE TABLE sf_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID NOT NULL REFERENCES sf_sessions(id) ON DELETE CASCADE,
  siesa_codigo      TEXT NOT NULL,                   -- f120_id (numeric SKU)
  nombre            TEXT NOT NULL,                   -- snapshot del nombre al momento del scan
  unidad_medida     TEXT NOT NULL,                   -- KL, LB, 500GR, UND, P6...
  cantidad          NUMERIC(10,3) NOT NULL,          -- 3 decimales: 0.500 (500gr), 1.250 (1.25kg), 2 (2 und)
  origen            TEXT NOT NULL
                    CHECK (origen IN ('scan_ean','scan_gs1','busqueda_manual')),
  ean_escaneado     TEXT,                            -- el EAN/GS1 escaneado, si aplica
  metadata          JSONB,                           -- libre: gs1_raw, lote, vencimiento, etc.
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sf_items_session ON sf_items (session_id);
CREATE INDEX idx_sf_items_siesa ON sf_items (siesa_codigo);
```

**Reglas de negocio:**

- `cantidad` siempre es positiva. "Quitar un item" = `DELETE`, no cantidad negativa.
- `ean_escaneado` se guarda para auditoría, aunque el producto resuelto sea otro.
- El frontend NO ve precios. Backend tampoco los guarda. Solo `siesa_codigo + cantidad + unidad_medida` viajan al QR.

### `sf_qr_tokens`

Tokens single-use que se generan al finalizar una sesión.

```sql
CREATE TABLE sf_qr_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES sf_sessions(id) ON DELETE CASCADE,
  token         TEXT NOT NULL UNIQUE,                -- HMAC-firmado, lo que va en el QR
  expires_at    TIMESTAMPTZ NOT NULL,
  redeemed_at   TIMESTAMPTZ,
  redeemed_by   UUID REFERENCES profiles(id),        -- opcional: quién en caja lo redimió
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sf_qr_tokens_session ON sf_qr_tokens (session_id);
CREATE UNIQUE INDEX idx_sf_qr_tokens_token ON sf_qr_tokens (token);
```

**Reglas:**

- Un token se considera **redimido** si `redeemed_at IS NOT NULL`. Reintento de redeem retorna 409.
- TTL configurable (`QR_TTL_MINUTES`, default 15 min).
- Si una sesión genera un nuevo QR (re-finalize en caso de error), el token anterior se invalida (se elimina o se marca `expires_at = now()`).

### `sf_audit_log`

Bitácora de eventos críticos.

```sql
CREATE TABLE sf_audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID REFERENCES sf_sessions(id) ON DELETE SET NULL,
  user_id       UUID REFERENCES profiles(id),
  action        TEXT NOT NULL,                       -- session.created, item.added, item.removed, session.finalized, qr.redeemed, ...
  payload       JSONB,                               -- contexto del evento
  ip            TEXT,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sf_audit_session ON sf_audit_log (session_id, created_at DESC);
CREATE INDEX idx_sf_audit_action ON sf_audit_log (action, created_at DESC);
```

**Acciones definidas:**

- `session.created`, `session.cancelled`, `session.finalized`
- `item.added`, `item.updated`, `item.removed`
- `qr.generated`, `qr.redeemed`, `qr.expired`
- `auth.unauthorized` (intento sin rol válido)

## Tablas existentes que reusamos

### `profiles` (existente — agregamos rol)

Usuarios de Supabase Auth. Sin Filas agrega un rol nuevo:

```sql
-- Asumiendo que profiles ya tiene una columna `rol` (text) o similar.
-- Si no existe, hay que agregarla:
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS rol TEXT;

-- Roles válidos para Sin Filas:
--   'cliente_vip'    → puede crear sesiones, escanear, finalizar
--   'admin_sf'       → todo lo anterior + cancelar/ver sesiones de otros (futuro)
```

> ⚠️ **Acción requerida antes de codear:** revisar el esquema actual de `profiles` para confirmar si tiene columna de rol, y cómo está estructurada (ENUM, TEXT, tabla aparte). Adaptar el middleware de auth en consecuencia.

### `wc_sedes` (existente — solo lectura)

Sede donde opera la sesión. Sin Filas usa solo `id`, `slug`, `nombre`, `activa`.

### `siesa_codigos_barras` (existente — solo lectura)

Catálogo de productos por código de barras. Estructura relevante:

| Columna | Uso en Sin Filas |
|---|---|
| `f120_id` | SKU numérico de SIESA — lo guardamos como `sf_items.siesa_codigo` |
| `descripcion` | Nombre del producto — lo snapshoteamos en `sf_items.nombre` |
| `codigo_barras` | EAN — lo buscamos al hacer scan |
| `unidad_medida` | KL, LB, 500GR, UND, P6 — define el flujo de cantidad |
| `requiere_peso` (si existe) | Booleano: si true, abrir modal de peso |

> ⚠️ **Acción requerida antes de codear:** mirar las columnas reales de `siesa_codigos_barras` (puede que algunas mencionadas tengan otro nombre). Adaptar las queries.

## Diagrama de relaciones

```
profiles ─────────────┐
 (cliente_vip)        │
                      │ vip_user_id
                      ▼
                 sf_sessions ◀──── wc_sedes
                  │  │  │            (sede_id)
                  │  │  └─────▶ sf_qr_tokens (1:N, último vigente)
                  │  └────────▶ sf_items (1:N)
                  │                │
                  │                │ siesa_codigo
                  │                ▼
                  │          siesa_codigos_barras
                  │
                  └────────▶ sf_audit_log (1:N)
```

## Migrations

Las migrations viven en `supabase/migrations/` siguiendo el formato `YYYYMMDDHHMMSS_descripcion.sql`. La primera:

```
supabase/migrations/20260508000000_init_sin_filas.sql
```

Contiene los `CREATE TABLE` de las 4 tablas `sf_*` y el `ALTER TABLE profiles` si hace falta.

## Row Level Security (RLS)

Activar RLS en todas las tablas `sf_*`. Políticas:

- `sf_sessions`: el VIP solo ve sus propias sesiones; admin_sf ve todas.
- `sf_items`: visibles si el usuario tiene acceso a la `session_id`.
- `sf_qr_tokens`: solo lectura por el dueño de la sesión y caja (rol caja a definir).
- `sf_audit_log`: solo lectura para admin_sf, escritura desde service role.

> Las políticas concretas se redactan cuando definamos el detalle del rol caja y el flujo de redeem.
