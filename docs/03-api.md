# 03 — API REST (estado real)

Base URL en producción: `https://backend-sin-filas.vercel.app/api/sf`.
Localmente: `http://localhost:3000/api/sf` (puerto 3000 por defecto).

> Este documento refleja **los endpoints que existen hoy en el código**. Lo que está marcado como _pendiente_ todavía no está implementado.

## Convenciones

- Todos los bodies y responses son JSON.
- Errores: `{ "error": "<code>", "detail": "<msg o array>" }`.
- Códigos: `400` validación, `401` auth, `404` no existe, `409` conflicto de estado, `500` interno.
- Fechas en ISO 8601 UTC.
- IDs UUID.
- Auth: endpoints protegidos esperan `Authorization: Bearer <jwt-supabase>`. El JWT se valida localmente con `SUPABASE_JWT_SECRET` (HS256).
- Sede: endpoints transaccionales esperan `X-Sede-ID: <uuid>`. Sin ese header se devuelve 400.

---

## `health`

### `GET /api/sf/health`

Health check del servicio. Sin auth.

**Response 200:**
```json
{ "status": "ok", "service": "Sin Filas API" }
```

---

## `catalog/`

### `GET /api/sf/catalog/search`

Busca productos por nombre, EAN, GS1-128 o `f120_id`. Devuelve resultados agrupados por producto con sus presentaciones útiles para selección manual.

**Auth:** ninguna (hoy abierto).
**Sede:** no se usa.

**Query params (Zod `searchQuerySchema`):**
- `query` (string, requerido, 2-100 chars) — texto de búsqueda.

**Comportamiento del backend (`catalog.controller.ts`):**

1. Si `query` es numérico y empieza con `29` y mide 13 chars → lo interpreta como GS1-128 con peso variable:
   - extrae `searchCode = "29" + dígitos 3-7` (SKU interno)
   - extrae `parsedGs1Weight = dígitos 8-12 / 1000` (kg)
   - busca `siesa_codigos_barras.codigo_barras LIKE '<searchCode>%'`
2. Si `query` es numérico (otros casos):
   - busca match exacto en `codigo_barras` o en `f120_id`
3. Si `query` no es numérico:
   - split por espacios y aplica un `ilike '%word%'` por palabra contra `f120_descripcion`

Resultado: join con `items_siesa` activo, agrupado por `f120_id`.

**Filtro de presentaciones útiles para búsqueda manual** (`catalog.utils.ts: isManualSearchPresentation`):

Cuando la búsqueda **NO** es numérica (escritura por texto), se filtran las presentaciones devueltas:
- **Pesables** (`unidad_medida` en `KL`, `LB`, `500GR`, `250GR`, `PZ`): solo se aceptan códigos `^29\d{4,6}$` (GS1 corto, listo para que el frontend le concatene peso + check digit).
- **No pesables** (`UND`, `P6`, `P25`, `P12`, ...): el código debe `endsWith(unidad_medida)` (ej. `185325UND`, `185325P25`).

Productos que quedan sin presentaciones útiles tras el filtro se descartan del resultado.

Cuando la búsqueda **SÍ es numérica** (escaneo o tipeo de código exacto), no se aplica este filtro — se devuelve la coincidencia tal cual para que el frontend pueda hacer match físico.

**Response 200 (texto, ej. "arroz" → item 185326):**
```json
[
  {
    "f120_id": "185326",
    "nombre": "ARROZ CONGO 500G",
    "presentaciones": [
      { "codigo_barras": "185325UND", "unidad_medida": "UND", "requiere_peso": false },
      { "codigo_barras": "185325P25", "unidad_medida": "P25", "requiere_peso": false }
    ]
  }
]
```

**Response 200 (texto, ej. "papaya" → item 5073 fruver):**
```json
[
  {
    "f120_id": "5073",
    "nombre": "PAPAYA",
    "presentaciones": [
      { "codigo_barras": "2900061", "unidad_medida": "KL", "requiere_peso": true }
    ]
  }
]
```

> Solo aparece `2900061` (GS1 corto). Los otros códigos del catálogo (`5073KL`, `0050730050730`, `5073+`, `61`, `50730050730`) se filtran.

**Response 200 (GS1-128 con peso embebido, ej. escaneo de `2998765012345`):**
```json
[
  {
    "f120_id": "98765",
    "nombre": "CARNE RES",
    "presentaciones": [
      { "codigo_barras": "2998765", "unidad_medida": "KL", "requiere_peso": true }
    ],
    "scanned_quantity": 1.234,
    "isGs1": true
  }
]
```

Cuando `isGs1: true`, el frontend agrega directo al carrito con `scanned_quantity` como cantidad y sin abrir modal de peso.

**Response 400 (validación):**
```json
{ "error": "validation-error", "detail": ["La búsqueda requiere al menos 2 caracteres"] }
```

**Response 500:**
```json
{ "error": "Error consultando catalogo", "detail": "<mensaje>" }
```

---

## `sessions/`

### `POST /api/sf/sessions/checkout-direct`

Crea la sesión y todos sus items de una sola vez (Lazy Sync). Inserta también un token QR sin expiración real.

**Middlewares:** `requireAuth` → `requireSede` → `Zod body`.

**Headers requeridos:**
- `Authorization: Bearer <jwt-supabase>` — el `sub` del JWT se usa como `vip_user_id`.
- `X-Sede-ID: <uuid>` — la sede en la que ocurre la sesión.
- `Content-Type: application/json`.

**Body (Zod `checkoutDirectBodySchema`):**
```json
{
  "items": [
    {
      "codigo_barras": "7700001234567",
      "nombre": "ARROZ 500G",
      "cantidad": 3,
      "unidad_medida": "UND"
    },
    {
      "codigo_barras": "2998765012345",
      "nombre": "CARNE RES",
      "cantidad": 1.234,
      "unidad_medida": "KL"
    }
  ],
  "raw_qr_string": "3*7700001234567\r\n2998765012345"
}
```

**Notas:**

- `vip_user_id` y `sede_id` **NO** se envían en el body — vienen del JWT y del header `X-Sede-ID` respectivamente.
- `raw_qr_string` se acepta opcionalmente pero **NO se persiste**: el QR lo arma el frontend y lo pinta en pantalla. El backend no persiste ningún token relacionado al QR.
- El estado de la sesión se inserta directo como `'finalizado'`.
- `total_items` = `items.length` (cantidad de líneas).
- `unidad_medida` tiene default `'UND'` si no se envía.
- `cantidad` debe ser un `number` positivo.

**Pipeline:**

1. `INSERT INTO sf_sessions (vip_user_id=req.user.id, sede_id=req.sedeId, estado='finalizado', total_items)`
2. `INSERT INTO sf_session_items (...)` con todos los items
3. `logAudit('session.finalized')`

Si falla el paso **2**, se hace **rollback manual** (`DELETE FROM sf_sessions WHERE id = ?` con CASCADE) y se escribe `session.rollback` en el audit log.

**Response 201:**
```json
{
  "session_id": "uuid",
  "success": true
}
```

**Errores:**

| Causa | HTTP | Body |
|---|---|---|
| Falta `Authorization` | 401 | `{ "error": "unauthorized", "detail": "Falta el header Authorization Bearer" }` |
| JWT inválido / expirado / sin `sub` | 401 | `{ "error": "invalid-token", "detail": "..." }` |
| `SUPABASE_JWT_SECRET` no configurado | 500 | `{ "error": "auth-not-configured" }` |
| Falta `X-Sede-ID` | 400 | `{ "error": "missing-sede-id", "detail": "Falta el header X-Sede-ID" }` |
| `X-Sede-ID` no es UUID | 400 | `{ "error": "invalid-sede-id" }` |
| Body inválido (items vacío, cantidad ≤ 0, etc.) | 400 | `{ "error": "validation-error", "detail": [{ path, message }, ...] }` |
| Falla Supabase | 500 | `{ "error": "<msg supabase>" }` |

---

### `GET /api/sf/sessions`

Historial de sesiones del VIP autenticado (sus propias sesiones). Es lo que consume el tab "Historial" del frontend SF.

**Middlewares:** `requireAuth`.
**Auth:** JWT obligatorio (filtra por `req.user.id`).
**Sede:** opcional. Si viene `X-Sede-ID`, filtra adicionalmente por esa sede.

**Body:** ninguno.

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "estado": "finalizado",
      "total_items": 3,
      "created_at": "2026-05-11T14:30:00Z",
      "items": [
        { "codigo_barras": "185325UND", "nombre": "ARROZ 500G", "cantidad": 3, "unidad_medida": "UND" }
      ]
    }
  ]
}
```

El response NO incluye ningún token de QR. Si el usuario reabre una sesión del historial, el frontend reconstruye el manifiesto QR localmente con `generateManifestQRValue(items)`.

---

## `admin/`

> Todas las rutas `/admin/*` están protegidas con `requireAuth + optionalSede` aplicados con `router.use`.
> Si se envía `X-Sede-ID`, los listados/agregados filtran por esa sede. Sin el header → vista global cross-sede.
>
> **Foco del panel admin:** registro, operación y analítica. El flujo de cobro/redención del QR lo gestiona el POS externo y NO se refleja en ninguno de estos endpoints (no se devuelve `sf_qr_tokens` ni se distingue "cobrado").

### `GET /api/sf/admin/stats`

KPIs del panel administrativo.

**Auth:** `requireAuth`.
**Sede:** `optionalSede` (filtra por `X-Sede-ID` si se envía).

**Response 200:**
```json
{
  "totalSessions": 124,
  "totalItems": 1843,
  "activeVips": 7,
  "cancelled": 4,
  "registered": 120,
  "sessionsToday": 11
}
```

| Campo | Definición |
|---|---|
| `totalSessions` | Cantidad total de filas en `sf_sessions` (filtradas por sede si aplica). |
| `totalItems` | Suma de `sf_sessions.total_items` (líneas registradas). |
| `activeVips` | Cantidad de `vip_user_id` únicos. |
| `cancelled` | Sesiones con `estado='cancelado'`. |
| `registered` | Sesiones con `estado != 'cancelado'`. |
| `sessionsToday` | Sesiones creadas hoy (corte a `00:00` local del proceso). |

---

### `GET /api/sf/admin/sessions`

Listado paginado de sesiones con filtros.

**Auth:** `requireAuth`.
**Sede:** `optionalSede`.

**Query params (Zod `sessionsQuerySchema`):**

| Param | Tipo | Default | Notas |
|---|---|---|---|
| `estado` | `'finalizado' \| 'cancelado'` | — | Filtra por estado exacto. |
| `search` | string (1-120) | — | Match case-insensitive sobre `profiles.nombre`, `profiles.correo` y el UUID de la sesión. |
| `limit` | int (1-200) | `50` | Tamaño de página. |
| `offset` | int (≥0) | `0` | Desplazamiento. |

**Response 200:**
```json
{
  "data": [
    {
      "id": "uuid",
      "estado": "finalizado",
      "total_items": 12,
      "created_at": "2026-05-11T14:30:00Z",
      "vip_user_id": "uuid",
      "sede_id": "uuid",
      "profiles": { "nombre": "María García", "correo": "maria@merkahorrosas.com" }
    }
  ],
  "total": 124
}
```

`total` es el `count` exacto que devuelve Supabase contemplando los filtros aplicados antes del `range()`.

---

### `GET /api/sf/admin/sessions/:id`

Detalle de una sesión + lista de items.

**Auth:** `requireAuth`.
**Params (Zod):** `id` debe ser UUID.

**Response 200:**
```json
{
  "session": {
    "id": "uuid",
    "estado": "finalizado",
    "total_items": 3,
    "created_at": "2026-05-11T14:30:00Z",
    "vip_user_id": "uuid",
    "sede_id": "uuid",
    "profiles": { "nombre": "María García", "correo": "maria@merkahorrosas.com" }
  },
  "items": [
    { "codigo_barras": "185325UND", "nombre_producto": "ARROZ 500G", "cantidad": 3, "unidad_medida": "UND" },
    { "codigo_barras": "29987650123 45", "nombre_producto": "CARNE RES", "cantidad": 1.234, "unidad_medida": "KL" }
  ]
}
```

**Errores:**

| Causa | HTTP | Body |
|---|---|---|
| `:id` no es UUID | 400 | `{ "error": "validation-error" }` |
| Sesión no existe | 404 | `{ "error": "session-not-found" }` |

---

### `GET /api/sf/admin/cancelled`

Sesiones con `estado='cancelado'` (últimas 100).

**Auth:** `requireAuth`.
**Sede:** `optionalSede`.

**Response 200:**
```json
{
  "data": [
    {
      "id": "uuid",
      "estado": "cancelado",
      "total_items": 5,
      "created_at": "2026-05-09T18:12:00Z",
      "vip_user_id": "uuid",
      "sede_id": "uuid",
      "profiles": { "nombre": "Juan Pérez", "correo": "juan@merkahorrosas.com" }
    }
  ],
  "total": 4
}
```

---

### `GET /api/sf/admin/analytics`

Series temporales y rankings para los charts del panel (Recharts).

**Auth:** `requireAuth`.
**Sede:** `optionalSede`.

**Query params (Zod `analyticsQuerySchema`):**

| Param | Tipo | Default | Notas |
|---|---|---|---|
| `days` | int (1-180) | `30` | Tamaño de la ventana. La ventana arranca a las `00:00` UTC del día `now - days`. |

**Response 200:**
```json
{
  "since": "2026-04-11T00:00:00.000Z",
  "days": 30,
  "daily":   [ { "date": "2026-04-11", "sessions": 4, "items": 27 } ],
  "states":  [ { "estado": "finalizado", "count": 118 }, { "estado": "cancelado", "count": 6 } ],
  "topVips": [ { "vip_user_id": "uuid", "nombre": "María", "correo": "maria@...", "sessions": 14, "items": 162 } ],
  "hourly":  [ { "hour": 0, "sessions": 0 }, { "hour": 9, "sessions": 12 } ],
  "totals":  { "sessions": 124, "items": 1843, "vips": 7 }
}
```

Estructuras:

- `daily` — 1 fila por día dentro del rango (incluye días sin actividad).
- `hourly` — array fijo de 24 elementos, uno por hora local del proceso.
- `topVips` — top 10 por cantidad de sesiones (desc); incluye `nombre`/`correo` con `'Sin nombre'` / `''` como fallback.
- `states` — distribución por `estado`.

---

## Pendientes de API

| Endpoint / mejora | Estado | Notas |
|---|---|---|
| Auth en `/admin/*` | ✅ Cerrado | `requireAuth + optionalSede`. |
| Filtro por sede en `/admin/*` | ✅ Cerrado | `optionalSede`: con `X-Sede-ID` filtra, sin él → global. |
| Endpoint `GET /admin/sessions/:id` con items | ✅ Cerrado | Detalle + items. |
| Analítica para charts | ✅ Cerrado | `/admin/analytics` con `daily`, `hourly`, `states`, `topVips`. |
| Endpoint `POST /sessions/:id/cancel` | ⏳ Pendiente | Para mover sesión a `cancelado` desde el panel. Hoy `cancelado` solo se setea desde BD. |
| Auth/secret en `/sessions/:id/redeem` | ⏳ Pendiente | Hoy abierto; aceptable mientras la URL no esté pública. |
| Rate limiting en `/admin/*` | ⏳ Pendiente | Sin protección. |
