-- ============================================================
-- Sin Filas — sumar puntos de venta chicos SIN afectar otros sistemas
-- ============================================================
--
-- Contexto: wc_sedes es COMPARTIDA. Picking, ecommerce y usuarios filtran
-- siempre `activa = true`. Para que esas sedes chicas existan SOLO en Sin Filas
-- las marcamos con `activa = false` (las esconde de todo lo demás) + un flag
-- nuevo `sf_activa = true` que solo mira Sin Filas.
--
-- Además guardamos la lista de precios SIESA por sede en una columna nueva
-- (`lista_precio_siesa`), para que el backend resuelva el precio data-driven y
-- no haya que tocar código al sumar una sede.
--
-- Correr en el SQL Editor de Supabase. Idempotente.

-- 1) Columnas nuevas en wc_sedes ----------------------------------------------
alter table public.wc_sedes
  add column if not exists sf_activa          boolean not null default false,
  add column if not exists lista_precio_siesa text;

-- 2) Sedes EXISTENTES: visibles en Sin Filas + su lista de precios SIESA -------
--    OJO: 'barbosa' estaba como P06 en el código (bug). Lo correcto es P07.
update public.wc_sedes set sf_activa = true, lista_precio_siesa = 'P01' where slug = 'copacabana-plaza';
update public.wc_sedes set sf_activa = true, lista_precio_siesa = 'P02' where slug = 'villahermosa';
update public.wc_sedes set sf_activa = true, lista_precio_siesa = 'P03' where slug = 'girardota';        -- Girardota Parque
update public.wc_sedes set sf_activa = true, lista_precio_siesa = 'P07' where slug = 'barbosa';

-- 3) Sedes NUEVAS: solo Sin Filas (activa=false) ------------------------------
--    Si tu wc_sedes tiene más columnas NOT NULL (ej. woo_meta_match), agregalas
--    acá. woo_meta_match queda null: estas sedes no entran por pedidos de Woo.
insert into public.wc_sedes (nombre, slug, activa, sf_activa, lista_precio_siesa)
select v.nombre, v.slug, false, true, v.lista
from (values
  ('Girardota Llano',     'girardota-llano',     'P04'),
  ('Copacabana Vegas',    'copacabana-vegas',    'P06'),
  ('Copacabana San Juan', 'copacabana-san-juan', 'P08')
) as v(nombre, slug, lista)
where not exists (
  select 1 from public.wc_sedes s where s.slug = v.slug
);

-- 4) Verificación -------------------------------------------------------------
select slug, nombre, activa, sf_activa, lista_precio_siesa
from public.wc_sedes
where sf_activa = true
order by lista_precio_siesa;
