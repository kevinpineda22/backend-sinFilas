-- Migración: agregar f120_id a sf_session_items
-- Objetivo: poder reconstruir la imagen del producto (desde WooCommerce, SKU = f120_id)
-- al reabrir una sesión desde el historial de "Sin Filas".
--
-- Seguro de re-ejecutar (IF NOT EXISTS). Nullable: las sesiones viejas quedan
-- con f120_id NULL y simplemente no mostrarán imagen en el historial.

ALTER TABLE public.sf_session_items
  ADD COLUMN IF NOT EXISTS f120_id integer NULL;

-- Índice opcional: útil si más adelante se reportan/agrupan items por producto.
CREATE INDEX IF NOT EXISTS idx_sf_items_f120
  ON public.sf_session_items USING btree (f120_id);
