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
      "unidad_medida": "UND",
      "f120_id": 185326,
      "precio": 4500
    },
    {
      "codigo_barras": "2998765012345",
      "nombre": "CARNE RES",
      "cantidad": 1.234,
      "unidad_medida": "KL",
      "f120_id": 98765,
      "precio": 18900
    }
  ],
  "raw_qr_string": "3*7700001234567\r\n2998765012345",
  "total_price": 28350
}
```

**Notas:**

- `vip_user_id` y `sede_id` **NO** se envían en el body — vienen del JWT y del header `X-Sede-ID` respectivamente.
- `raw_qr_string` se acepta opcionalmente pero **NO se persiste**: el QR lo arma el frontend y lo pinta en pantalla. El backend no persiste ningún token relacionado al QR.
- `f120_id` (opcional) — id de producto SIESA. Se usa para resolver el pasillo del ítem (cache `sf_producto_pasillos`) y para reconstruir la imagen desde Woo al reabrir la sesión. Si falta, el ítem queda sin pasillo (no rompe el checkout).
- `precio` (opcional, ≥ 0) — precio unitario que el carrito resolvió contra SIESA al escanear. Se persiste en `sf_session_items.precio_unitario`. Si falta o es 0, queda en 0.
- `total_price` (opcional, ≥ 0) — total informativo que manda el frontend. **El backend NO confía en él**: recalcula `total_precio = Σ(precio × cantidad)` desde los ítems como única fuente de verdad.
- El estado de la sesión se inserta directo como `'completada'`.
- `total_items` = `items.length` (cantidad de líneas).
- `unidad_medida` tiene default `'UND'` si no se envía.
- `cantidad` debe ser un `number` positivo.

**Pipeline:**

1. `INSERT INTO sf_sessions (vip_user_id=req.user.id, sede_id=req.sedeId, estado='completada', total_items, total_precio)`
2. Resuelve pasillos por sede desde `sf_producto_pasillos` (best-effort; si falla, los ítems quedan sin pasillo).
3. `INSERT INTO sf_session_items (...)` con todos los items, incluyendo `precio_unitario`, `posicion`, `pasillo`, `pasillo_orden`, `f120_id`.
4. `logAudit('session.finalized')`

Si falla el paso **3**, se hace **rollback manual** (`DELETE FROM sf_sessions WHERE id = ?` con CASCADE) y se escribe `session.rollback` en el audit log.

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
      "estado": "completada",
      "total_items": 3,
      "total_precio": 13500,
      "created_at": "2026-05-11T14:30:00Z",
      "items": [
        { "codigo_barras": "185325UND", "nombre": "ARROZ 500G", "cantidad": 3, "unidad_medida": "UND", "f120_id": 185326, "precio": 4500 }
      ]
    }
  ]
}
```

`total_precio` (cabecera) y `precio` (por ítem, mapeado desde `precio_unitario`) permiten que el frontend muestre el valor de la compra al reabrir la sesión. El response NO incluye ningún token de QR. Si el usuario reabre una sesión del historial, el frontend reconstruye el manifiesto QR localmente con `generateManifestQRValue(items)`.

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
| `estado` | `'en_proceso' \| 'completada'` | — | Filtra por estado exacto. |
| `vip_user_id` | uuid | — | Filtra por VIP (lo usa la vista de un VIP puntual). |
| `search` | string (1-120) | — | Match case-insensitive sobre `profiles.nombre`, `profiles.correo` y el UUID de la sesión. |
| `limit` | int (1-200) | `50` | Tamaño de página. |
| `offset` | int (≥0) | `0` | Desplazamiento. |

**Response 200:**
```json
{
  "data": [
    {
      "id": "uuid",
      "estado": "completada",
      "total_items": 12,
      "total_precio": 84200,
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
    "estado": "completada",
    "total_items": 3,
    "total_precio": 32400,
    "created_at": "2026-05-11T14:30:00Z",
    "vip_user_id": "uuid",
    "sede_id": "uuid",
    "profiles": { "nombre": "María García", "correo": "maria@merkahorrosas.com" }
  },
  "items": [
    { "codigo_barras": "185325UND", "nombre_producto": "ARROZ 500G", "cantidad": 3, "unidad_medida": "UND", "posicion": 0, "pasillo": "3", "pasillo_orden": 3, "f120_id": 185326, "precio_unitario": 4500 },
    { "codigo_barras": "2998765012345", "nombre_producto": "CARNE RES", "cantidad": 1.234, "unidad_medida": "KL", "posicion": 1, "pasillo": "7", "pasillo_orden": 7, "f120_id": 98765, "precio_unitario": 18900 }
  ]
}
```

Los items vienen ordenados por `posicion` (orden de escaneo). `precio_unitario` por ítem y `total_precio` en la cabecera alimentan el detalle del panel admin.

**Errores:**

| Causa | HTTP | Body |
|---|---|---|
| `:id` no es UUID | 400 | `{ "error": "validation-error" }` |
| Sesión no existe | 404 | `{ "error": "session-not-found" }` |

---

### `DELETE /api/sf/admin/sessions/:id`

Elimina una sesión completa desde el panel admin.

**Auth:** `requireAuth`.
**Params (Zod):** `id` debe ser UUID.

**Comportamiento (`admin.controller.ts: deleteSession`):**

1. Valida que `:id` sea UUID (400 si no).
2. Verifica que la sesión exista (404 si no) — así el frontend distingue "ya no estaba" de un fallo real.
3. `DELETE FROM sf_sessions WHERE id = ?`. Los `sf_session_items` y `sf_qr_tokens` se borran en cascada por sus FK (`ON DELETE CASCADE`). Las filas de `sf_audit_log` se conservan (FK `ON DELETE SET NULL`).
4. `logAudit('session.deleted')` con `session_id: null` y el id en `details.deleted_session_id` (no se puede referenciar la sesión recién borrada en `session_id` por la FK).

**Response 200:**
```json
{ "success": true, "id": "uuid" }
```

**Errores:**

| Causa | HTTP | Body |
|---|---|---|
| Falta `Authorization` | 401 | `{ "error": "unauthorized" }` |
| `:id` no es UUID | 400 | `{ "error": "validation-error", "detail": "id debe ser UUID" }` |
| Sesión no existe | 404 | `{ "error": "session-not-found", "detail": "La sesión no existe" }` |
| Falla Supabase | 500 | `{ "error": "<msg>" }` |

> En el frontend, el borrado se dispara desde el modal de detalle (`SFSessionDetailModal`) con confirmación inline; al completarse refresca KPIs y listado. Un 404 se muestra como "la sesión ya no existe".

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
  "states":  [ { "estado": "completada", "count": 118 }, { "estado": "en_proceso", "count": 6 } ],
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
| Endpoint `GET /admin/sessions/:id` con items | ✅ Cerrado | Detalle + items (incluye precios y pasillos). |
| Endpoint `DELETE /admin/sessions/:id` | ✅ Cerrado | Borra sesión con validación de existencia + audit `session.deleted`. |
| Persistencia de precios | ✅ Cerrado | `precio_unitario` por ítem + `total_precio` por sesión (recalculado server-side). |
| Analítica para charts | ✅ Cerrado | `/admin/analytics` con `daily`, `hourly`, `states`, `topVips`. |
| Endpoint `POST /sessions/:id/cancel` | ⏳ Pendiente | Para mover sesión a `cancelado` desde el panel. Hoy `cancelado` solo se setea desde BD. |
| Auth/secret en `/sessions/:id/redeem` | ⏳ Pendiente | Hoy abierto; aceptable mientras la URL no esté pública. |
| Rate limiting en `/admin/*` | ⏳ Pendiente | Sin protección. |
