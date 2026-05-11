# Sistema "Sin Filas" — Estado y Arquitectura

Sistema interno de pre-escaneo: un empleado escanea/pesa los productos del cliente en la fila del supermercado y genera un QR compatible con el POS de la caja para agilizar el cobro.

> Documentación detallada en [`docs/`](./docs):
> - [`01-arquitectura.md`](./docs/01-arquitectura.md) — visión, diagrama, decisiones
> - [`02-base-de-datos.md`](./docs/02-base-de-datos.md) — tablas reales y FKs
> - [`03-api.md`](./docs/03-api.md) — endpoints implementados
> - [`04-flujos.md`](./docs/04-flujos.md) — flujos Lazy Sync
> - [`05-estructura-codigo.md`](./docs/05-estructura-codigo.md) — layout y convenciones
> - [`06-supabase-setup.sql`](./docs/06-supabase-setup.sql) — schema canónico
> - [`07-roles-setup.sql`](./docs/07-roles-setup.sql) — `role_permissions`

## 1. Componentes

### A. Frontend (`Pagina-web_React/src/pages/sinFilas`)

App React (Vite) embebida en el repositorio principal de la web.

- **Naming:** todos los componentes específicos llevan prefijo `SF` (`SFApp.jsx`, `SFManualSearch.jsx`, etc.) para no chocar con el resto del e-commerce.
- **Rutas:** `/sin-filas` (app de escaneo) y `/sin-filas/admin` (dashboard).
- **Sede gate:** al entrar a `/sin-filas`, si el usuario no tiene sede concreta (super_admin con `"todas"` o sin selección previa), se muestra `SFSedeSelector` que obliga a elegir una sede activa. La selección se persiste en `localStorage.sf_sede_id`.
- **Auth:** JWT de Supabase. Cualquier usuario autenticado puede operar (no se filtra por rol).
- **QR:** el backend NO firma JWTs. El frontend arma la cadena exacta que entiende el POS (`QTY*CODE\r\n` y GS1 de 13 dígitos para pesables) en `gs1Utils.js` y la renderiza con `qrcode.react`.
- **Estado del carrito:** Zustand 5 con `persist` (`localStorage`). Se acumula localmente y se envía completo al hacer checkout.
- **Modal de peso:** se ingresan **gramos enteros**. La conversión a kg vive dentro de `handleWeightSubmit` antes de generar el GS1.
- **Estilos:** CSS puro (no usamos Tailwind en este proyecto).

### B. Backend (`Backend-sinFilas`)

Express 5 + TypeScript, deploy serverless en Vercel.

- **Entry:** `src/server.ts` → `src/app.ts`.
- **Vercel:** `vercel.json` con `@vercel/node`, `maxDuration: 30`.
- **Middlewares globales:** CORS (origin `*`), Helmet (CORP `cross-origin`), express.json, morgan.
- **Auth:** `requireAuth` valida el JWT de Supabase con `jsonwebtoken` localmente (sin llamada HTTP a Supabase por request) e inyecta `req.user = { id, email, role }`.
- **Sede:** `requireSede` lee `X-Sede-ID`, valida UUID e inyecta `req.sedeId`.
- **Validación:** Zod en bodies/queries/params (schemas por módulo).
- **Audit:** `logAudit()` escribe en `sf_audit_log` para eventos clave (`session.finalized`, `qr.generated`, `qr.redeemed`, `session.rollback`).
- **Endpoints activos:**
  - `GET /api/sf/health`
  - `GET /api/sf/catalog/search` — con filtro de presentaciones útiles para búsqueda manual
  - `POST /api/sf/sessions/checkout-direct` — con auth + sede + Zod + rollback transaccional
  - `POST /api/sf/sessions/:id/redeem` — para el POS
  - `GET /api/sf/admin/{stats,sessions,users}`
- **CORS:** abierto a cualquier origen + OPTIONS preflight.

### C. Base de datos (Supabase)

PostgreSQL compartido con `backend-woocommerce`. Tablas con prefijo `sf_`:

- `sf_sessions` — cabecera del carrito (ENUM `sf_session_state`: `en_proceso`, `finalizado`, `cobrado`, `cancelado`).
- `sf_session_items` — items escaneados/pesados.
- `sf_qr_tokens` — token UUID por sesión, con `used_at` que el endpoint `/redeem` actualiza.
- `sf_audit_log` — bitácora; ya se escribe desde el backend.

Detalles y SQL canónico en [`docs/06-supabase-setup.sql`](./docs/06-supabase-setup.sql).

## 2. Decisiones arquitectónicas clave

1. **Lazy Sync (Checkout Directo).** El carrito vive en el frontend hasta "Finalizar"; ahí se envía completo a `/api/sf/sessions/checkout-direct`. Cero llamadas per-item.
2. **QR generado en el frontend.** El POS lee la string cruda del QR sin pasar por el backend. El backend solo persiste un UUID de auditoría.
3. **Tokens sin expiración real.** `expires_at` se inserta como `2099-12-31T23:59:59Z` por compatibilidad con un POS offline futuro.
4. **Sin restricción por rol.** Cualquier empleado autenticado puede operar (decisión del producto para días de alta carga).
5. **Sede obligatoria por sesión.** Super_admins (sin sede asignada en `profiles`) deben elegir una en el `SFSedeSelector` antes de operar. Persistido en `localStorage.sf_sede_id`.
6. **Filtro de presentaciones para búsqueda manual.** En el buscador, solo se muestran códigos útiles para selección (GS1 corto `29XXXXX` para pesables; sufijo de unidad `185325UND`, `187825P6` para no-pesables). El escáner sigue aceptando cualquier código.
7. **Peso en gramos.** El modal de peso pide gramos enteros (báscula real). La conversión a kg vive dentro del frontend antes de armar el GS1.
8. **Rollback manual.** Supabase REST no soporta transacciones; si falla items o token al hacer checkout, se borra la sesión recién creada (CASCADE limpia hijos).
9. **Audit fire-and-forget.** `logAudit` nunca rompe la operación principal. Sus errores quedan loggeados.

## 3. Comandos

```bash
npm run dev          # nodemon src/server.ts
npm run build        # tsc → dist/
npm start            # node dist/server.js
npm test             # vitest (modo watch)
npm run test:run     # vitest run (single pass, CI)
npm run typecheck    # tsc --noEmit
```

## 4. Variables de entorno (`.env`)

```env
PORT=3000
NODE_ENV=development

SUPABASE_URL=
SUPABASE_KEY=               # service_role
SUPABASE_JWT_SECRET=        # OBLIGATORIO para requireAuth
QR_SIGNING_SECRET=          # opcional, uso futuro
```

`src/config/env.ts` valida con Zod al arrancar y aborta si faltan `SUPABASE_URL` o `SUPABASE_KEY`. `SUPABASE_JWT_SECRET` se considera obligatorio en producción (sin él, `requireAuth` responde 500 a todo).

## 5. Estado de los gaps históricos

| Gap | Estado |
|---|---|
| Validación JWT en backend | ✅ Cerrado (`requireAuth` con `jsonwebtoken`) |
| Validación Zod en bodies | ✅ Cerrado (`catalog.schemas`, `sessions.schemas`) |
| `sede_id` y `vip_user_id` en UUID cero | ✅ Cerrado (vienen de JWT + header `X-Sede-ID`) |
| Rollback transaccional en checkout-direct | ✅ Cerrado (DELETE de sesión + CASCADE) |
| Escritura en `sf_audit_log` | ✅ Cerrado (`logAudit` conectado) |
| Endpoint `/sessions/:id/redeem` | ✅ Cerrado |
| `tsconfig` strict | ⚠️ Parcial (`noImplicitAny` + `strictNullChecks` ON, `strict` aún en `false`) |
| Tests | ✅ 84 tests verdes con Vitest + supertest |
| Refactor a capas service/repository | ⏳ Pendiente |
| Auth en `/admin/*` | ⏳ Pendiente (hoy abierto) |
| RLS en tablas `sf_*` | ⏳ Pendiente (hoy se usa `service_role`) |
| Dashboard admin con filtro de sede | ⏳ Pendiente (intencional, se difiere) |

## 6. Cómo probar end-to-end

1. Tener el dev server corriendo (`npm run dev`).
2. En el frontend (`http://localhost:5173/sin-filas`):
   - Si tu user es super_admin, te aparece el selector de sede; elegí una.
   - Si tenés sede asignada en `profiles`, entra directo.
3. Escaneá o buscá un producto, agregalo al carrito.
4. Finalizá → ves el QR.
5. Para marcar el QR como cobrado (simulando POS):
   ```bash
   curl -X POST https://backend-sin-filas.vercel.app/api/sf/sessions/<session_id>/redeem
   ```
6. El dashboard admin debería mostrar la sesión como "Cobrado" + el `used_at` registrado.

---

_Mantener este README sincronizado con [`docs/`](./docs)._
