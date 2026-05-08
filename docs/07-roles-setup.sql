-- ==============================================================================
-- SCRIPT DE INSERCIÓN DE PERMISOS PARA SIN FILAS
-- Ejecutar en el SQL Editor de Supabase
-- ==============================================================================

-- 1. Insertar o actualizar permisos para el empleado VIP (el que usa el celular en la fila)
INSERT INTO public.role_permissions (role, permissions)
VALUES (
  'sf_vip', 
  '["/sin-filas"]'::jsonb
)
ON CONFLICT (role) DO UPDATE 
SET permissions = '["/sin-filas"]'::jsonb;

-- 2. Insertar o actualizar permisos para el Administrador Sin Filas (el que mira analíticas)
INSERT INTO public.role_permissions (role, permissions)
VALUES (
  'sf_admin', 
  '["/sin-filas", "/sin-filas/admin"]'::jsonb
)
ON CONFLICT (role) DO UPDATE 
SET permissions = '["/sin-filas", "/sin-filas/admin"]'::jsonb;
