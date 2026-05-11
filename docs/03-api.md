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
- `raw_qr_string` se acepta opcionalmente pero **NO se persiste**: el QR lo arma el frontend y lo pinta en pantalla. El backend solo persiste un UUID en `sf_qr_tokens.token` como registro.
- El estado de la sesión se inserta directo como `'finalizado'`.
- `total_items` = `items.length` (cantidad de líneas).
- `unidad_medida` tiene default `'UND'` si no se envía.
- `cantidad` debe ser un `number` positivo.

**Pipeline:**

1. `INSERT INTO sf_sessions (vip_user_id=req.user.id, sede_id=req.sedeId, estado='finalizado', total_items)`
2. `INSERT INTO sf_session_items (...)` con todos los items
3. `INSERT INTO sf_qr_tokens (session_id, token=uuid, expires_at='2099-12-31T23:59:59Z')`
4. `logAudit('session.finalized')`
5. `logAudit('qr.generated')`

Si falla alguno de los pasos **2 o 3**, se hace **rollback manual** (`DELETE FROM sf_sessions WHERE id = ?` con CASCADE) y se escribe `session.rollback` en el audit log.

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

### `POST /api/sf/sessions/:id/redeem`

Lo llama el POS al cobrar la sesión. Marca el token QR como usado y la sesión como `cobrado`.

**Middlewares:** Zod params (UUID).
**Auth:** ninguna (el POS no maneja JWTs de Supabase). Pendiente: agregar shared-secret o JWT de sistema si se expone públicamente.
**Sede:** no se usa (la sede ya está en la sesión).

**Body:** vacío.

**Pipeline:**

1. `SELECT id, estado FROM sf_sessions WHERE id = :id`
2. Si no existe → 404.
3. Si `estado === 'cobrado'` → 409 (idempotente).
4. Si `estado === 'cancelado'` → 409.
5. `UPDATE sf_qr_tokens SET used_at = now() WHERE session_id = :id`
6. `UPDATE sf_sessions SET estado='cobrado', updated_at=now() WHERE id = :id`
7. `logAudit('qr.redeemed')`

**Response 200:**
```json
{
  "success": true,
  "session_id": "uuid",
  "redeemed_at": "2026-05-11T15:42:00.000Z"
}
```

**Errores:**

| Causa | HTTP | Body |
|---|---|---|
| `:id` no es UUID | 400 | `{ "error": "validation-error", "detail": ["id debe ser uuid"] }` |
| Sesión no existe | 404 | `{ "error": "session-not-found" }` |
| Sesión ya cobrada | 409 | `{ "error": "session-already-redeemed" }` |
| Sesión cancelada | 409 | `{ "error": "session-cancelled" }` |
| Falla Supabase | 500 | `{ "error": "<msg>" }` |

---

## `admin/`

> ⚠️ Hoy `/admin/*` está **abierto** (sin auth). Es deuda conocida; el dashboard administrativo se difiere a la próxima fase.

### `GET /api/sf/admin/stats`

KPIs del dashboard.

**Response 200:**
```json
{
  "totalSessions": 124,
  "totalItems": 1843,
  "activeVips": 7
}
```

- `totalSessions` = `count(*)` de `sf_sessions`.
- `totalItems` = `sum(cantidad)` de `sf_session_items` (sumado en memoria).
- `activeVips` = cantidad de `vip_user_id` únicos en `sf_sessions`.

### `GET /api/sf/admin/sessions`

Últimas 50 sesiones con su token QR asociado (incluye `used_at`).

**Response 200:**
```json
[
  {
    "id": "uuid",
    "estado": "finalizado",
    "total_items": 12,
    "created_at": "2026-05-11T14:30:00Z",
    "vip_user_id": "uuid",
    "sede_id": "uuid",
    "sf_qr_tokens": [
      { "used_at": null }
    ]
  }
]
```

- `sf_qr_tokens[0].used_at != null` → caja ya cobró este QR.
- Estado `cobrado` + `used_at` poblado se sincroniza con el endpoint `/redeem`.

### `GET /api/sf/admin/users`

Listado plano de usuarios (`profiles`). No filtra por rol.

**Response 200:**
```json
[
  { "user_id": "uuid", "nombre": "Juan Pérez", "correo": "juan@merkahorrosas.com", "role": "admin" },
  { "user_id": "uuid", "nombre": "María García", "correo": "maria@merkahorrosas.com", "role": "sf_vip" }
]
```

---

## Pendientes de API

| Endpoint / mejora | Estado | Notas |
|---|---|---|
| Auth en `/admin/*` | Pendiente | Hoy abierto. |
| Endpoint `GET /sessions/:id` con items | Pendiente | Para auditar detalle desde el dashboard. |
| Endpoint `POST /sessions/:id/cancel` | Pendiente | Para mover sesión a `cancelado` desde admin. |
| Auth/secret en `/sessions/:id/redeem` | Pendiente | Hoy abierto; aceptable mientras la URL no esté pública. |
| Filtro por sede en `/admin/*` | Diferido | Forma parte de la fase del dashboard avanzado. |
| Rate limiting en `/admin/*` | Pendiente | Sin protección. |
