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
- **QR:** el backend ya no firma JWTs. El frontend arma la cadena exacta que entiende el POS (`QTY*CODE\r\n` y GS1 de 13 dígitos para pesables) en `gs1Utils.js` y la renderiza con `qrcode.react`.
- **Estado del carrito:** Zustand 5 con `persist` (`localStorage`). Se acumula localmente y se envía completo al hacer checkout.
- **Estilos:** CSS puro (no usamos Tailwind en este proyecto).

### B. Backend (`Backend-sinFilas`)

Express 5 + TypeScript, deploy serverless en Vercel.

- **Entry:** `src/server.ts` → `src/app.ts`.
- **Vercel:** `vercel.json` con `@vercel/node`, `maxDuration: 30`.
- **Módulos activos:**
  - `GET /api/sf/health`
  - `GET /api/sf/catalog/search`
  - `POST /api/sf/sessions/checkout-direct`
  - `GET /api/sf/admin/{stats,sessions,users}`
- **CORS:** abierto a cualquier origen + OPTIONS preflight.

### C. Base de datos (Supabase)

PostgreSQL compartido con `backend-woocommerce`. Tablas con prefijo `sf_`:

- `sf_sessions` — cabecera del carrito (ENUM `sf_session_state`: `en_proceso`, `finalizado`, `cobrado`, `cancelado`).
- `sf_session_items` — items escaneados/pesados.
- `sf_qr_tokens` — token UUID por sesión, con `used_at` para registrar redención (hoy no se escribe).
- `sf_audit_log` — bitácora (existe, sin escritura aún).

Detalles y SQL canónico en [`docs/06-supabase-setup.sql`](./docs/06-supabase-setup.sql).

## 2. Decisiones arquitectónicas clave

1. **Lazy Sync (Checkout Directo).** El carrito vive en el frontend hasta "Finalizar"; ahí se envía completo a `/api/sf/sessions/checkout-direct`. Cero llamadas per-item.
2. **QR generado en el frontend.** El POS lee la string cruda del QR sin pasar por el backend. El backend solo persiste un UUID de auditoría.
3. **Tokens sin expiración real.** `expires_at` se inserta como `2099-12-31T23:59:59Z` por compatibilidad con un POS offline futuro.
4. **Sin restricción por rol.** Cualquier empleado con la URL puede operar. El producto lo decidió así para días de alta carga.
5. **Backend simplificado.** Se eliminaron del plan original los módulos `auth`, `items`, `checkout/redeem`; sus responsabilidades quedan absorbidas por `sessions` y `admin` o se posponen.

## 3. Comandos

```bash
npm run dev     # nodemon src/server.ts
npm run build   # tsc → dist/
npm start       # node dist/server.js
```

## 4. Variables de entorno (`.env`)

```env
PORT=3000
NODE_ENV=development

SUPABASE_URL=
SUPABASE_KEY=               # service_role
SUPABASE_JWT_SECRET=        # opcional, uso futuro
QR_SIGNING_SECRET=          # opcional, uso futuro
```

`src/config/env.ts` valida con Zod al arrancar y aborta si faltan `SUPABASE_URL` o `SUPABASE_KEY`.

## 5. Gaps conocidos (priorizados)

1. **No hay validación de JWT.** `vip_user_id` y `sede_id` caen a UUID cero si el frontend no los manda.
2. **`sf_qr_tokens.used_at` nunca se escribe.** Falta endpoint `POST /sessions/:id/redeem` (o equivalente) para que el POS marque la redención.
3. **`checkout-direct` no es transaccional.** Si falla items o token, la sesión queda huérfana.
4. **`sf_audit_log` está creado pero nadie escribe.** Falta `auditWriter` compartido.
5. **Sin validación Zod en bodies.** Solo `env.ts` usa Zod.
6. **`tsconfig` con `strict: false`.** Reduce el valor de TS.
7. **AdminDashboard:** verificar el binding de campos (`correo`, `role`) tras la última pasada de doc.
8. **Sin tests.** No hay Vitest configurado.

---

_Mantener este README sincronizado con [`docs/`](./docs)._
