# 01 — Arquitectura del sistema

## Visión

Sin Filas es una herramienta interna de **agilización de fila**. Un empleado (de confianza) asiste a un cliente en la fila del supermercado, escanea o busca los productos de su carrito y, al terminar, **genera un QR localmente** que la caja lee para cargar todo de golpe al ticket del POS.

**No reemplaza** la caja. No procesa pagos. No muestra precios.

## Decisión arquitectónica madre: Lazy Sync + QR local

Dos elecciones definen todo el resto del sistema:

1. **Lazy Sync.** El carrito no se sincroniza con el backend a cada acción. Se acumula en `localStorage` (Zustand persist) y viaja en un único `POST /sessions/checkout-direct` al finalizar.
2. **QR generado en el frontend.** El string que entra al QR es exactamente el que el POS de la caja sabe leer (formato `QTY*CODE\r\n` + GS1 de 13 dígitos para pesables). El backend no firma ni codifica nada en el QR — solo persiste un token UUID de auditoría.

Esas dos decisiones eliminan: latencia por scan, dependencia del backend en la fila, sincronización de catálogo con el POS, y validación remota desde la caja.

## Diagrama del sistema real

```
┌────────────────────────┐
│  Frontend (sinFilas)   │      Frontend embebido en Pagina-web_React
│  - SFApp (escáner +    │      Reusa EscanerBarras del picking.
│    carrito + QR)       │      Carrito en Zustand persist (localStorage).
│  - AdminDashboard      │      QR generado con qrcode.react.
└────────┬───────────────┘
         │
         │ Axios + Bearer token
         │ (interceptor en sfApi.js — token Supabase no validado por backend hoy)
         ▼
┌──────────────────────────────────────────────────────────────┐
│         Backend Sin Filas (Express 5 + TS, en Vercel)        │
│                                                              │
│  src/modules/                                                │
│   ├─ catalog    GET /catalog/search                          │
│   ├─ sessions   POST /sessions/checkout-direct               │
│   └─ admin      GET /admin/{stats, sessions, users}          │
│                                                              │
│  src/shared/db/supabaseClient.ts (service_role)              │
└────────┬─────────────────────────────────────────────────────┘
         │
         │ Service role key (bypassa RLS)
         ▼
┌─────────────────────────────────────────────────────────────┐
│             Supabase (PostgreSQL compartido con picking)     │
│                                                              │
│  Tablas sf_*:                                                │
│   - sf_sessions       (ENUM sf_session_state)                │
│   - sf_session_items                                         │
│   - sf_qr_tokens      (used_at = null hasta que POS confirme)│
│   - sf_audit_log      (existe, sin escritura aún)            │
│                                                              │
│  Tablas reusadas (sólo lectura):                             │
│   - profiles (user_id, nombre, correo, role)                 │
│   - wc_sedes                                                 │
│   - items_siesa + siesa_codigos_barras                       │
│   - role_permissions                                         │
└─────────────────────────────────────────────────────────────┘

                         ║
              No hay conexión backend ↔ POS (todavía).
              El POS lee la string cruda del QR y no llama al backend.
                         ║

┌────────────────────────┐
│  POS de la caja        │      Lee QR como texto plano:
│  (sistema externo)     │      "3*7700001234\r\n2998765..."
└────────────────────────┘      Mismo formato que el picking.
```

## Módulos del backend (estado real)

| Módulo | Endpoint | Responsabilidad |
|---|---|---|
| `catalog` | `GET /catalog/search` | Busca productos por texto, EAN o GS1-128. Detecta peso embebido en GS1 (prefijo `29`). Agrupa por `f120_id` con presentaciones (`unidad_medida` + `requiere_peso`). |
| `sessions` | `POST /sessions/checkout-direct` | Recibe el carrito completo, inserta sesión + items + token UUID. Una sola llamada por sesión. |
| `admin` | `GET /admin/stats` `GET /admin/sessions` `GET /admin/users` | Datos para el dashboard administrativo (KPIs, historial, usuarios). |
| `health` | `GET /health` | Health check para Vercel. |

### Módulos del plan inicial que NO existen (y por qué)

Los borramos al pivotear a Lazy Sync:

| Módulo eliminado | Por qué no se necesitó |
|---|---|
| `auth` (verifyJwt + requireRole) | Hoy no hay auth real. Cualquier empleado con la URL puede entrar. Pendiente reintegrar como middleware. |
| `items` (CRUD por item) | El frontend acumula el carrito local y manda todo de una en `checkout-direct`. No hay edición remota. |
| `checkout/redeem` (POS valida QR contra backend) | El POS lee la string cruda del QR sin pasar por el backend. |

## Stack

| Capa | Elección |
|---|---|
| Runtime | Node.js |
| Framework | Express 5 |
| Lenguaje | TypeScript (con `strict: false` — pendiente de endurecer) |
| Validación | Zod (sólo en `config/env.ts`; pendiente extender a bodies) |
| DB | Supabase (PostgreSQL) — mismo proyecto que picking |
| Auth | Supabase Auth (JWT) — **no validado en backend hoy** |
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

## Lecciones del picking que (todavía) NO aplicamos

Estas las teníamos como objetivos al diseñar Sin Filas, pero el código actual aún no las cumple. Listadas para resolverlas en próximas iteraciones:

| Objetivo | Estado |
|---|---|
| Capas separadas `route → controller → service → repository` | Parcial. Tenemos `route → controller` que hacen todo. Falta `service` y `repository`. |
| Validación Zod en bodies | Pendiente. Sólo `env.ts` usa Zod. |
| Errores tipados + middleware central | Pendiente. Cada controller hace su `try/catch + res.status(500)`. |
| Logs estructurados (Pino) | Pendiente. Hoy `console.error` y `morgan` para HTTP. |
| Tests con Vitest | Pendiente. No hay configuración ni archivos. |
| `tsconfig` strict | Pendiente. `strict: false` (algunos null checks se escapan). |
| Audit log conectado | Pendiente. Tabla creada, código no la usa. |

## Lo que NO entra en v1

Para evitar scope creep:

- App para el cliente común (auto-scan).
- Sync de catálogo desde WooCommerce.
- Reportes avanzados / heatmaps.
- Notificaciones push.
- Modo offline robusto con queue de reintento (la v1 asume conexión al hacer el `checkout-direct`).
- Identificación del cliente final (cédula, lealtad, cupones).
- Validación del QR contra backend desde el POS (depende del equipo del POS).
