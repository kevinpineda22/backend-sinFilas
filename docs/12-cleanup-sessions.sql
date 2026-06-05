-- LIMPIEZA DE DATOS TRANSACCIONALES — Sin Filas
-- Vacía SOLO los datos de sesiones. NO toca configuración ni catálogo.
--
-- Borra:   sf_sessions, sf_session_items, sf_audit_log
-- Conserva: wc_sedes, sf_sede_pasillos, sf_sede_layout, sf_producto_pasillos,
--           items_siesa, siesa_codigos_barras
--
-- TRUNCATE ... CASCADE limpia sf_session_items automáticamente (FK -> sf_sessions).
-- RESTART IDENTITY reinicia secuencias. Ejecutar en el editor SQL de Supabase.

BEGIN;

TRUNCATE TABLE
  public.sf_sessions,
  public.sf_session_items,
  public.sf_audit_log
  RESTART IDENTITY CASCADE;

COMMIT;

-- Verificación: las tres deben dar 0.
SELECT 'sf_sessions'      AS tabla, COUNT(*) AS filas FROM public.sf_sessions
UNION ALL
SELECT 'sf_session_items' AS tabla, COUNT(*) AS filas FROM public.sf_session_items
UNION ALL
SELECT 'sf_audit_log'     AS tabla, COUNT(*) AS filas FROM public.sf_audit_log;
