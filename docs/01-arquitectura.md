# 01 — Arquitectura del sistema

## Visión

Sin Filas es una herramienta interna de **agilización de fila**. Un empleado VIP (de confianza) asiste a un cliente en la fila, escanea o busca los productos de su carrito, y al terminar genera un QR que la caja lee para cargar todo de golpe en el POS.

**No reemplaza** la caja, no procesa pagos, no tiene precios visibles. Solo prepara el manifiesto de productos para que el cobro sea rápido.

## Diagrama de flujo

```
┌──────────────┐   1. login OTP/email      ┌───────────────────┐
│ Empleado VIP │──────────────────────────▶│  Supabase Auth    │
│   (mobile)   │   (rol = cliente_vip)     │  + tabla profiles │
└──────┬───────┘                           └───────────────────┘
       │
       │ 2. POST /sf/sessions  (crea sesión vacía)
       ▼
┌──────────────────────────────────────────────────────────────┐
│                  Backend Sin Filas (Express)                  │
│                                                                │
│  modules/                                                      │
│   ├─ auth     (verifica JWT + rol)                            │
│   ├─ catalog  (búsqueda por nombre / EAN / SKU)               │
│   ├─ sessions (crear, listar, finalizar)                      │
│   ├─ items    (agregar / quitar / editar)                     │
│   └─ checkout (generar QR firmado, redeem)                    │
└────────┬───────────────────────────────────┬─────────────────┘
         │                                   │
         │ tablas sf_*                       │ tablas reusadas
         ▼                                   ▼
   ┌──────────────┐                  ┌────────────────────┐
   │ sf_sessions  │                  │ siesa_codigos_     │
   │ sf_items     │                  │   barras           │
   │ sf_qr_tokens │                  │ wc_sedes           │
   │ sf_audit_log │                  │ profiles           │
   └──────────────┘                  └────────────────────┘

   3. agregar items (scan / búsqueda) → sf_items
   4. POST /sf/sessions/:id/finalize → genera token QR
   5. caja escanea QR → POST /sf/checkout/redeem → devuelve manifiesto
```

## Módulos del backend

| Módulo | Responsabilidad |
|---|---|
| `auth` | Verifica JWT de Supabase, valida que el rol sea `cliente_vip` o superior. Middleware. |
| `catalog` | Búsqueda de productos por nombre, EAN, SKU. Devuelve presentaciones disponibles (`unidad_medida`). |
| `sessions` | CRUD de sesiones de carrito. Estados: `abierta` → `finalizada` → `cobrada` / `cancelada`. |
| `items` | Agregar, editar (cantidad/peso), quitar items de una sesión abierta. |
| `checkout` | Generar QR firmado al finalizar. Endpoint de redeem para la caja. |

Cada módulo se estructura como `route → controller → service → repository`. Detalle en [`05-estructura-codigo.md`](05-estructura-codigo.md).

## Stack y razones

| Capa | Elección | Por qué |
|---|---|---|
| Runtime | Node.js | Lo que el equipo maneja |
| Framework | Express 5 | Ya lo usan en picking, cero curva de aprendizaje |
| Lenguaje | TypeScript | Caza errores en build time. La diferencia con el picking en JS la vamos a sentir desde el primer mes. |
| Validación | Zod | Schemas que sirven para validar runtime Y derivar tipos TS |
| DB | Supabase (PostgreSQL) | Mismo proyecto que picking — usuarios, sedes, barcodes ya existen |
| Auth | Supabase Auth (JWT) | Reuso total, solo agregamos un rol |
| Tests | Vitest | Mismo runner que picking |
| Deploy | Vercel | Mismo provider, mismo workflow |

## Lecciones del picking que aplicamos

Esto NO es opcional. Son las cosas que en `backend-woocommerce` arrastramos como deuda y acá no repetimos:

### 1. TypeScript desde día 1
En picking, errores como `id_picker undefined` o `body sin productId` los descubrís en producción. Acá los caza el compilador.

### 2. Validación en el border con Zod
Ningún controller recibe datos sin validar. Cero `req.body.algo` confiando que está bien tipado.

### 3. Sin código duplicado entre frontend y backend
`manifestPricing.js` está duplicado en `utils/` (CommonJS) y `ecommerce/shared/` (ESM) en picking. Acá los schemas Zod del backend se exportan y el frontend los consume tipados (cuando migremos el front a TS) o como referencia documental (mientras siga en JS).

### 4. Variables de entorno, NUNCA URLs hardcodeadas
En picking, `ecommerceApi.js` tiene la URL de Vercel hardcodeada. Acá usamos `import.meta.env.VITE_SF_API_URL` o equivalente.

### 5. Sin caches en memoria en serverless
`wooMultiService` tiene caches con TTL en memoria. En Vercel cada invocación es proceso nuevo: el cache **no sirve**. Acá: si necesitamos cachear, lo hacemos en DB (con `expires_at`) o no cacheamos.

### 6. Capas separadas: route → controller → service → repository
En picking los controllers hacen de todo (validar, llamar a Supabase, llamar a Woo, formatear respuesta). Acá:

- **route**: define método + path, monta middlewares, llama al controller
- **controller**: parsea con Zod, llama al service, formatea response
- **service**: lógica de negocio, orquesta repositorios y servicios externos
- **repository**: queries a Supabase, encapsula la forma de la tabla

### 7. Errores tipados y middleware global
En picking hay `try/catch` con `console.error` en cada controller. Acá:

- Clases de error (`NotFoundError`, `UnauthorizedError`, `ValidationError`, `ConflictError`)
- Un único middleware al final del pipeline que mapea error → status + body JSON

### 8. Logs estructurados con Pino
Reemplazamos `console.log` por logger con niveles, request ID y contexto. En Vercel los logs estructurados son buscables.

### 9. Tests en `tests/` separados, NO al lado del código
En picking los `.test.js` viven al lado del archivo. Funciona pero ensucia la lectura del módulo. Acá: `tests/<modulo>/<archivo>.test.ts`.

### 10. Audit log con cola, no fire-and-forget
`auditService.js` en picking es fire-and-forget: si Supabase está caído, perdés el evento. Acá los eventos críticos se insertan **dentro de la misma transacción** que la operación principal cuando es posible, o con reintento explícito.

## Reuso del backend de WooCommerce

Lo que **copiamos** (en `src/shared/`):

- `barcode/gs1Utils.ts` — parsing GS1-128 (prefijo 29 = peso variable de carnicería)
- `barcode/barcodeFilter.ts` — clasificación de tipos de barcode
- `pricing/manifestPricing.ts` — cálculo de cargo por línea (lo dejamos por si lo necesitamos para validaciones)
- `units/weighableUnits.ts` — clasificación KL/LB/500GR/UND

Lo que **NO copiamos** (no aplica al alcance):

- WooCommerce REST client — Sin Filas no habla con WooCommerce
- Sede service multi-tenant complejo — usamos un único campo `sede_id` por sesión
- Sync service — no hay sync, el manifiesto va directo al QR

## Lo que no entra en v1

Para evitar scope creep, estas cosas las dejamos para fases siguientes:

- App para el cliente común (auto-scan)
- Sync de catálogo desde WooCommerce
- Reportes y analytics
- Notificaciones push
- Modo offline robusto (la v1 asume conexión, fallback básico en IndexedDB)
- Identificación del cliente final (cédula, lealtad, cupones)
