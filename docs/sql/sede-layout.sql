-- ============================================================
-- Feature: Mapa interactivo de la tienda + recorrido del VIP
-- ------------------------------------------------------------
-- Dos tablas:
--   1) sf_sede_pasillos  → CATÁLOGO de pasillos por sede (id + nombre + orden).
--      Fuente de verdad: SEDES_CONFIG de mapeadorPasillos.js.
--      Lo puebla el sync (backend-woocommerce/tools/syncPasilloCache.js).
--   2) sf_sede_layout    → POSICIONES del editor (x,y) de cada nodo del plano.
--      Lo escribe el panel admin al guardar el layout de una sede.
--
-- Correr en el SQL Editor de Supabase. Idempotente.
-- ============================================================

-- 1. Catálogo de pasillos por sede (poblado por el sync desde SEDES_CONFIG)
create table if not exists sf_sede_pasillos (
  sede_slug     text        not null,
  pasillo       text        not null,
  nombre        text        not null,
  pasillo_orden integer     not null,
  updated_at    timestamptz not null default now(),
  primary key (sede_slug, pasillo)
);

create index if not exists idx_sf_sede_pasillos_sede
  on sf_sede_pasillos (sede_slug);

-- 2. Layout (posiciones) del plano por sede.
--    nodo_id = id de pasillo (ej. "7") o un nodo especial: '__entrada__' / '__caja__'.
--    tipo    = 'pasillo' | 'entrada' | 'caja'.
create table if not exists sf_sede_layout (
  sede_slug  text             not null,
  nodo_id    text             not null,
  tipo       text             not null default 'pasillo',
  etiqueta   text,
  x          double precision not null default 0,
  y          double precision not null default 0,
  ancho      double precision,
  alto       double precision,
  updated_at timestamptz      not null default now(),
  primary key (sede_slug, nodo_id)
);

create index if not exists idx_sf_sede_layout_sede
  on sf_sede_layout (sede_slug);

-- Chequeo: ver el catálogo poblado por sede (correr DESPUÉS del sync)
-- select sede_slug, count(*) from sf_sede_pasillos group by sede_slug;
