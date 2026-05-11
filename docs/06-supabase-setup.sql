-- ==============================================================================
-- SCRIPT CANONICO DE SCHEMA "SIN FILAS"
-- Refleja el estado REAL del proyecto Supabase asociado al backend Sin Filas.
-- Ejecutar en el SQL Editor de Supabase.
-- ==============================================================================

-- 0. ENUM de estados de sesion
-- Si ya existe, este bloque se puede saltar.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sf_session_state') THEN
    CREATE TYPE public.sf_session_state AS ENUM (
      'en_proceso',
      'finalizado',
      'cobrado',
      'cancelado'
    );
  END IF;
END
$$;


-- 1. Tabla de Sesiones (sf_sessions)
CREATE TABLE IF NOT EXISTS public.sf_sessions (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  vip_user_id   uuid NOT NULL,
  sede_id       uuid NOT NULL,
  estado        public.sf_session_state NOT NULL DEFAULT 'en_proceso',
  total_items   numeric NOT NULL DEFAULT 0,
  created_at    timestamptz NULL DEFAULT now(),
  updated_at    timestamptz NULL DEFAULT now(),
  CONSTRAINT sf_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT sf_sessions_sede_id_fkey FOREIGN KEY (sede_id)
    REFERENCES public.wc_sedes (id) ON DELETE RESTRICT,
  CONSTRAINT sf_sessions_vip_user_id_fkey FOREIGN KEY (vip_user_id)
    REFERENCES public.profiles (user_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_sf_sessions_vip
  ON public.sf_sessions USING btree (vip_user_id);
CREATE INDEX IF NOT EXISTS idx_sf_sessions_sede
  ON public.sf_sessions USING btree (sede_id);
CREATE INDEX IF NOT EXISTS idx_sf_sessions_estado
  ON public.sf_sessions USING btree (estado);


-- 2. Tabla de Items de la sesion (sf_session_items)
-- OJO: el nombre real es sf_session_items, no sf_items.
CREATE TABLE IF NOT EXISTS public.sf_session_items (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id        uuid NOT NULL,
  codigo_barras     text NOT NULL,
  nombre_producto   text NULL,
  cantidad          numeric NOT NULL DEFAULT 1,
  unidad_medida     text NULL DEFAULT 'UND'::text,
  created_at        timestamptz NULL DEFAULT now(),
  CONSTRAINT sf_session_items_pkey PRIMARY KEY (id),
  CONSTRAINT sf_session_items_session_id_fkey FOREIGN KEY (session_id)
    REFERENCES public.sf_sessions (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sf_items_session
  ON public.sf_session_items USING btree (session_id);


-- 3. Tabla de Tokens QR (sf_qr_tokens)
-- La columna que marca "ya cobrado en caja" es used_at (NO redeemed_at).
CREATE TABLE IF NOT EXISTS public.sf_qr_tokens (
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id   uuid NOT NULL,
  token        text NOT NULL,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz NULL,
  created_at   timestamptz NULL DEFAULT now(),
  CONSTRAINT sf_qr_tokens_pkey PRIMARY KEY (id),
  CONSTRAINT sf_qr_tokens_token_key UNIQUE (token),
  CONSTRAINT sf_qr_tokens_session_id_fkey FOREIGN KEY (session_id)
    REFERENCES public.sf_sessions (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sf_qr_token
  ON public.sf_qr_tokens USING btree (token);


-- 4. Tabla de Audit Log (sf_audit_log)
-- La tabla existe en BD pero todavia NO se escribe desde el codigo.
-- Cuando se conecte, usar `details` (jsonb) para guardar el payload del evento.
CREATE TABLE IF NOT EXISTS public.sf_audit_log (
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id   uuid NULL,
  user_id      uuid NULL,
  action       text NOT NULL,
  details      jsonb NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NULL DEFAULT now(),
  CONSTRAINT sf_audit_log_pkey PRIMARY KEY (id),
  CONSTRAINT sf_audit_log_session_id_fkey FOREIGN KEY (session_id)
    REFERENCES public.sf_sessions (id) ON DELETE SET NULL,
  CONSTRAINT sf_audit_log_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES public.profiles (user_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_sf_audit_session
  ON public.sf_audit_log USING btree (session_id);


-- ==============================================================================
-- TABLAS REUSADAS (existentes en el proyecto, NO se crean aqui):
--   - public.profiles        (PK: user_id)
--   - public.wc_sedes        (PK: id)
--   - public.items_siesa     (catalogo de productos)
--   - public.siesa_codigos_barras (codigos de barras + presentaciones)
--   - public.role_permissions (matriz de rutas por rol — ver 07-roles-setup.sql)
-- ==============================================================================
