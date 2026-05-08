# Backend Sin Filas

Backend del sistema **Sin Filas**: herramienta interna para empleados VIP que asisten a clientes en la fila del supermercado, escaneando los productos del carrito y generando un QR que se lee en la caja para agilizar el cobro.

> **Esto NO es customer-facing.** El cliente común no instala nada. Un empleado de confianza (rol `cliente_vip`) opera la app sobre el carrito del cliente.

---

## Stack

- **Node.js + Express 5 + TypeScript** (backend)
- **Zod** para validación en los borders
- **Supabase** (PostgreSQL + Auth) — mismo proyecto que `backend-woocommerce`
- **Vitest** para tests
- **Vercel** para deploy serverless

## Estructura del repositorio

```
Backend-sinFilas/
├── docs/                  ← documentación del sistema (leé esto antes de tocar código)
├── src/                   ← código del backend (a construir)
├── tests/                 ← tests con Vitest
├── .env.example           ← variables de entorno requeridas
├── package.json
├── tsconfig.json
└── vercel.json
```

## Documentación

Leé en orden:

1. [`docs/01-arquitectura.md`](docs/01-arquitectura.md) — visión del sistema, módulos, lecciones aprendidas del picking
2. [`docs/02-base-de-datos.md`](docs/02-base-de-datos.md) — tablas nuevas y reusadas, SQL listo para correr
3. [`docs/03-api.md`](docs/03-api.md) — endpoints con request/response
4. [`docs/04-flujos.md`](docs/04-flujos.md) — sesión, fruver, carnicería, QR (diagramas)
5. [`docs/05-estructura-codigo.md`](docs/05-estructura-codigo.md) — layout de carpetas, convenciones, cómo agregar un módulo

## Variables de entorno

```env
PORT=3001
NODE_ENV=development

# Supabase (mismo proyecto que backend-woocommerce)
SUPABASE_URL=...
SUPABASE_KEY=...
SUPABASE_JWT_SECRET=...

# Firma del QR (HMAC)
QR_SIGNING_SECRET=...
QR_TTL_MINUTES=15
```

## Comandos (a definir cuando exista código)

- `npm run dev` — servidor con auto-reload (`tsx watch src/app.ts`)
- `npm run build` — compila TS a JS (`tsc`)
- `npm start` — corre la versión compilada
- `npm test` — Vitest en modo watch
- `npm run test:run` — Vitest una vez (CI)
- `npm run typecheck` — `tsc --noEmit`

## Decisiones clave

| Decisión | Por qué |
|---|---|
| **Sin precios en la app** | El POS calcula precios al leer el QR. Cero riesgo de descuadre. |
| **TypeScript en backend** | Cazamos errores en build time. La curva es chica viniendo de JS. |
| **Frontend sigue en JS** | Para no sumar fricción al equipo. Migramos cuando sea cómodo. |
| **Tablas con prefijo `sf_`** | Aislamos del picking sin mezclar dominios. Compartimos `wc_sedes`, `siesa_codigos_barras`, `profiles`. |
| **Auth con Supabase JWT** | Reusamos el mismo sistema que el resto. Solo agregamos rol `cliente_vip`. |

## Relación con `backend-woocommerce`

Repos **separados y deployados independiente**, pero comparten:

- Misma base Supabase
- Misma tabla `siesa_codigos_barras` (catálogo de barcodes)
- Misma tabla `wc_sedes` (sucursales)
- Tabla `profiles` (usuarios) con un rol nuevo (`cliente_vip`)

Lógica que se **copia** (no se importa): GS1 utils, manifest pricing, weighable units, sede config. Mantenemos sincronizadas las dos copias hasta que tengamos un paquete compartido.
