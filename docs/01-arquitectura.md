# 01 — Arquitectura del sistema

## Visión

Sin Filas es una herramienta interna de **agilización de fila**. Un empleado (de confianza) asiste a un cliente en la fila del supermercado, escanea o busca los productos de su carrito y, al terminar, **genera un QR localmente** que la caja lee para cargar todo de golpe al ticket del POS.

**No reemplaza** la caja. No procesa pagos. No muestra precios.

## Decisiones arquitectónicas madre

1. **Lazy Sync.** El carrito no se sincroniza con el backend a cada acción. Se acumula en `localStorage` (Zustand persist) y viaja en un único `POST /sessions/checkout-direct` al finalizar.
2. **QR generado en el frontend.** El string que entra al QR es exactamente el que el POS de la caja sabe leer (formato `QTY*CODE\r\n` + GS1 de 13 dígitos para pesables). El backend no firma ni codifica nada en el QR — solo persiste un token UUID de auditoría.
3. **Sede obligatoria por sesión.** Cualquier sesión nace asociada a una sede (`wc_sedes.id`). Si el usuario es super_admin sin sede asignada, el frontend lo manda a un selector antes de dejarlo operar.
4. **Cualquier rol autenticado puede operar.** No se restringe por rol; la única barrera es JWT válido + sede activa.

## Diagrama del sistema real

```
┌────────────────────────────────────────────────────────────┐
│        Frontend (Pagina-web_React/src/pages/sinFilas)     │
│                                                            │
│  Entry: SFApp.jsx                                          │
│   └─ useSFSede() carga sedes activas (Supabase)            │
│       ├─ si NO hay sede → SFSedeSelector                   │
│       └─ si SÍ hay sede → SFAppInner con la app real       │
│                                                            │
│  Componentes:                                              │
│   - SFManualSearch (debounce de búsqueda por texto)        │
│   - SFPresentationModal (elige unidad)                     │
│   - SFWeightModal (gramos enteros para pesables)           │
│   - EscanerBarras (reuso del picking, cámara)              │
│   - QRCodeSVG (qrcode.react)                               │
│                                                            │
│  State: Zustand persist (`sf-cart-storage` en localStorage)│
│  Selección de sede: `sf_sede_id` en localStorage           │
└────────┬───────────────────────────────────────────────────┘
         │
         │ Axios + Bearer JWT (Supabase) + X-Sede-ID
         ▼
┌──────────────────────────────────────────────────────────────┐
│         Backend Sin Filas (Express 5 + TS, Vercel)           │
│                                                              │
│  middlewares globales:                                       │
│   cors(*) → helmet → express.json → morgan                   │
│                                                              │
│  modules/                                                    │
│   ├─ catalog/                                                │
│   │   └─ GET /catalog/search                                 │
│   │      Filtro de presentaciones útiles (catalog.utils.ts)  │
│   │      - Pesables: solo GS1 corto 29\d{4,6}                │
│   │      - No pesables: codigo endsWith(unidad_medida)       │
│   │                                                          │
│   ├─ sessions/                                               │
│   │   ├─ POST /sessions/checkout-direct                      │
│   │   │   [requireAuth + requireSede + Zod]                  │
│   │   │   Inserta sesión + items + token. Rollback manual    │
│   │   │   (DELETE sf_sessions) si falla items/token.         │
│   │   │   Audit: session.finalized                           │
│   │   │                                                      │
│   │   └─ GET /sessions                                       │
│   │       [requireAuth] Historial del VIP autenticado.       │
│   │                                                          │
│   └─ admin/                                                  │
│       [requireAuth + optionalSede aplicados con router.use]  │
│       GET /admin/stats         — KPIs del panel              │
│       GET /admin/sessions      — listado con filtros (Zod)   │
│       GET /admin/sessions/:id  — detalle + items             │
│       GET /admin/cancelled     — sesiones canceladas         │
│       GET /admin/analytics     — series para charts          │
│                                                              │
│  shared/                                                     │
│   ├─ db/supabaseClient.ts (service_role, bypassa RLS)        │
│   ├─ middleware/auth.ts (requireAuth — JWT local)            │
│   ├─ middleware/sede.ts (requireSede + optionalSede)         │
│   └─ audit/auditWriter.ts (logAudit fire-and-forget)         │
└────────┬─────────────────────────────────────────────────────┘
         │
         │ Service role key (bypassa RLS)
         ▼
┌─────────────────────────────────────────────────────────────┐
│             Supabase (PostgreSQL compartido)                 │
│                                                              │
│  Tablas sf_*:                                                │
│   - sf_sessions       (ENUM sf_session_state)                │
│   - sf_session_items                                         │
│   - sf_audit_log      (se escribe desde logAudit)            │
│                                                              │
│  Tablas reusadas (sólo lectura):                             │
│   - profiles (user_id, nombre, correo, role)                 │
│   - wc_sedes                                                 │
│   - items_siesa + siesa_codigos_barras                       │
│   - role_permissions                                         │
└─────────────────────────────────────────────────────────────┘

                         ║
              No hay conexión backend ↔ POS.
              El POS lee la string cruda del QR y procesa la
              venta sin tocar este backend. Sin Filas termina
              en la generación del QR.
                         ║

┌────────────────────────┐
│  POS de la caja        │      Lee QR como texto plano:
│  (sistema externo)     │      "3*7700001234\r\n2998765..."
└────────────────────────┘      Mismo formato que el picking.
```

## Módulos del backend

| Módulo | Endpoint | Middlewares | Responsabilidad |
|---|---|---|---|
| `catalog` | `GET /catalog/search` | (ninguno) | Busca productos por texto, EAN o GS1-128. Filtra presentaciones útiles para selección manual (`catalog.utils.ts`). |
| `sessions` | `POST /sessions/checkout-direct` | `requireAuth`, `requireSede`, Zod body | Recibe el carrito completo, inserta sesión + items con rollback. Escribe audit log. |
| `sessions` | `GET /sessions` | `requireAuth`, `optionalSede` | Historial del VIP autenticado (sus propias sesiones + items). El QR se reconstruye localmente desde los items. |
| `admin` | `GET /admin/stats` | `requireAuth`, `optionalSede` | KPIs del panel (totalSessions, totalItems, activeVips, cancelled, registered, sessionsToday). |
| `admin` | `GET /admin/sessions` | `requireAuth`, `optionalSede`, Zod query | Listado paginado con filtros `estado` + `search`. |
| `admin` | `GET /admin/sessions/:id` | `requireAuth`, `optionalSede`, Zod params | Detalle de una sesión + sus items. |
| `admin` | `GET /admin/cancelled` | `requireAuth`, `optionalSede` | Sesiones con `estado='cancelado'`. |
| `admin` | `GET /admin/analytics` | `requireAuth`, `optionalSede`, Zod query | Series para charts (`daily`, `hourly`, `states`, `topVips`, `totals`). |
| `health` | `GET /health` | (ninguno) | Health check. |

## Middlewares compartidos

| Middleware | Qué hace |
|---|---|
| `requireAuth` (`shared/middleware/auth.ts`) | Valida `Authorization: Bearer <jwt>` con `SUPABASE_JWT_SECRET` localmente (jsonwebtoken). Inyecta `req.user = { id, email, role }`. Sin llamada HTTP a Supabase. 401 si falta o es inválido. |
| `requireSede` (`shared/middleware/sede.ts`) | Lee `X-Sede-ID`, valida UUID, inyecta `req.sedeId`. 400 si falta o es inválido. |
| `optionalSede` | Versión laxa de `requireSede`: no falla si falta el header. |
| `logAudit` (`shared/audit/auditWriter.ts`) | Helper async para insertar en `sf_audit_log`. Fire-and-forget (no rompe la operación si falla). |

## Stack

| Capa | Elección |
|---|---|
| Runtime | Node.js |
| Framework | Express 5 |
| Lenguaje | TypeScript (`strictNullChecks` + `noImplicitAny` ON; `strict` aún OFF) |
| Validación | Zod en `env.ts` y en bodies/params de cada módulo |
| Auth backend | `jsonwebtoken` validando HS256 contra `SUPABASE_JWT_SECRET` |
| DB | Supabase (PostgreSQL) — mismo proyecto que picking |
| Tests | Vitest + supertest + mock encadenable de Supabase |
| Frontend | React 19 + Vite (embebido en Pagina-web_React) |
| Estado FE | Zustand 5 (cart con `persist`) |
| QR | `qrcode.react` |
| Cámara | `EscanerBarras` reutilizado del picking |
| Deploy | Vercel (serverless, `maxDuration: 30s`) |

## Reuso del backend de WooCommerce

Lo que **compartimos por convención**:

- Mismo proyecto Supabase (tablas existentes: `profiles`, `wc_sedes`, `items_siesa`, `siesa_codigos_barras`, `role_permissions`).
- Mismo lector de QR del POS (formato del manifiesto del picking).
- Mismo componente `EscanerBarras` del frontend.

Lo que **NO reutilizamos**:

- WooCommerce REST client (Sin Filas no habla con Woo).
- Sede service multi-tenant del picking (Sin Filas usa solo `sede_id` plano por sesión).
- Servicios de sync (no hay sync — el QR va directo al POS).

## Lecciones del picking aplicadas (estado actual)

| Práctica | Estado |
|---|---|
| Validación Zod en bodies | ✅ Sí, en cada módulo |
| Auth tipado en `req.user` | ✅ Sí (`requireAuth` + augmentation de `Express.Request`) |
| Audit log conectado | ✅ Sí (`logAudit` en eventos clave) |
| Tests con runner moderno | ✅ Vitest + supertest, 84 tests verdes |
| TypeScript estricto | ⚠️ Parcial (`strictNullChecks` + `noImplicitAny` ON) |
| Capas `route → controller → service → repository` | ⏳ Pendiente (hoy `route → controller` que hace todo) |
| Logger estructurado (Pino) | ⏳ Pendiente (hoy `console.error` + `morgan`) |

## Lo que NO entra en esta fase

- App para el cliente común (auto-scan).
- Sync de catálogo desde WooCommerce.
- Notificaciones push.
- Modo offline robusto con queue de reintento.
- Identificación del cliente final (cédula, lealtad, cupones).
- Cualquier flujo de cobro, pago, redención o validación de caja. **Intencional**: el sistema termina en la generación del QR. El POS de caja procesa la venta de forma independiente y no comunica nada de vuelta a este backend.
