-- ==============================================================================
-- SCRIPT DE CREACIÓN DE TABLAS PARA SIN FILAS
-- Ejecutar en el SQL Editor de Supabase
-- ==============================================================================

-- 1. Tabla de Sesiones (sf_sessions)
CREATE TABLE sf_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vip_user_id     UUID NOT NULL, -- En tu BD real, pon REFERENCES profiles(id)
  sede_id         UUID NOT NULL, -- En tu BD real, pon REFERENCES wc_sedes(id)
  estado          TEXT NOT NULL DEFAULT 'finalizada' -- Simplificado para el flujo directo
                  CHECK (estado IN ('abierta','finalizada','cobrada','cancelada')),
  total_items     INTEGER NOT NULL DEFAULT 0,
  cliente_nota    TEXT,                              
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalized_at    TIMESTAMPTZ,
  redeemed_at     TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ
);

CREATE INDEX idx_sf_sessions_vip_estado ON sf_sessions (vip_user_id, estado);
CREATE INDEX idx_sf_sessions_sede_estado ON sf_sessions (sede_id, estado);
CREATE INDEX idx_sf_sessions_created_at ON sf_sessions (created_at DESC);

-- 2. Tabla de Items (sf_items)
CREATE TABLE sf_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID NOT NULL REFERENCES sf_sessions(id) ON DELETE CASCADE,
  siesa_codigo      TEXT NOT NULL,
  nombre            TEXT NOT NULL,
  unidad_medida     TEXT NOT NULL,
  cantidad          NUMERIC(10,3) NOT NULL,
  codigo_barras     TEXT NOT NULL, -- GS1 O EAN final a mostrar
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sf_items_session ON sf_items (session_id);
CREATE INDEX idx_sf_items_siesa ON sf_items (siesa_codigo);

-- 3. Tabla de Tokens QR (sf_qr_tokens)
CREATE TABLE sf_qr_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES sf_sessions(id) ON DELETE CASCADE,
  token         TEXT NOT NULL UNIQUE,                
  expires_at    TIMESTAMPTZ NOT NULL,
  redeemed_at   TIMESTAMPTZ,
  redeemed_by   UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sf_qr_tokens_session ON sf_qr_tokens (session_id);
CREATE UNIQUE INDEX idx_sf_qr_tokens_token ON sf_qr_tokens (token);
