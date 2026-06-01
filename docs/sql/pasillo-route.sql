-- ============================================================
-- Feature: Ruta de pasillos del cliente VIP — Migración (Fase 0)
-- Correr en: Supabase → SQL Editor
-- Idempotente: se puede correr más de una vez sin romper nada.
-- ============================================================

-- 1) Cache producto → pasillo por sede (la puebla tools/syncPasilloCache.js)
create table if not exists sf_producto_pasillos (
  f120_id         integer     not null,
  sede_slug       text        not null,
  pasillo         text        not null,
  pasillo_orden   integer     not null,
  nombre_producto text,
  updated_at      timestamptz not null default now(),
  primary key (f120_id, sede_slug)
);

create index if not exists idx_sf_producto_pasillos_sede
  on sf_producto_pasillos (sede_slug);

-- 2) Datos de ruta por ítem (se llenan al checkout, en createDirectCheckout)
alter table sf_session_items
  add column if not exists posicion      integer,
  add column if not exists pasillo        text,
  add column if not exists pasillo_orden  integer;

-- ============================================================
-- 3) CHEQUEO DE SLUGS (no modifica nada — solo verificá el resultado)
--    Los slugs de wc_sedes deben coincidir con las keys de SEDES_CONFIG
--    en mapeadorPasillos.js: copacabana-plaza, girardota, barbosa, villahermosa.
--    Si alguno NO está en esa lista, el mapeador caerá al default en silencio.
-- ============================================================
select
  slug,
  nombre,
  activa,
  case
    when slug in ('copacabana-plaza','girardota','barbosa','villahermosa')
      then 'OK — mapeada'
    else '⚠ NO coincide con SEDES_CONFIG → caería al default'
  end as estado_mapeo
from wc_sedes
order by activa desc, slug;
