-- ==============================================================================
-- SCRIPT CANONICO DE SCHEMA "SIN FILAS"
-- Refleja el estado REAL del proyecto Supabase asociado al backend Sin Filas.
-- Ejecutar en el SQL Editor de Supabase.
--
-- Si tu proyecto venia de una version anterior que tenia sf_qr_tokens y/o el
-- valor 'cobrado' en el enum, mira tambien 08-migration-remove-cobros.sql.
-- ==============================================================================

-- 0. ENUM de estados de sesion
-- 'cobrado', 'finalizado' y 'cancelado' permanecen en la definicion solo por
-- compatibilidad historica:
--   - El backend NO los escribe nunca.
--   - Postgres no soporta REMOVE VALUE en un enum sin renombrar el tipo,
--     por eso se dejan inertes.
-- Estados activos en codigo: 'en_proceso', 'completada'.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sf_session_state') THEN
    CREATE TYPE public.sf_session_state AS ENUM (
      'en_proceso',
      'completada',
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


-- 3. Tabla de Audit Log (sf_audit_log)
-- Escribe `logAudit()` desde el backend (fire-and-forget).
-- Acciones activas en codigo: 'session.finalized', 'session.rollback'.
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
--
-- TABLAS QUE YA NO EXISTEN (eliminadas al cortar el flujo de cobros):
--   - public.sf_qr_tokens    (token UUID por sesion + used_at)
--   Si tu proyecto aun la tiene, corre 08-migration-remove-cobros.sql.
-- ==============================================================================
