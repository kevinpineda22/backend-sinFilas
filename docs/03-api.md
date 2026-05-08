# 03 — API REST

Base URL: `/api/sf` (todas las rutas montadas bajo este prefijo).

Todas las rutas (excepto `redeem` desde caja, ver final) requieren JWT de Supabase con rol `cliente_vip` o `admin_sf` en el header:

```
Authorization: Bearer <jwt>
X-Sede-ID: <uuid-sede>
```

`X-Sede-ID` es obligatorio en endpoints que crean/modifican sesiones. Lo inyecta un middleware similar al `sedeMiddleware` del picking.

---

## Convenciones

- Todos los bodies y responses son JSON.
- Errores: `{ "error": { "code": "STRING_KEBAB", "message": "Descripción humana", "details": {} } }`
- Códigos: `400` validación, `401` sin auth, `403` sin permiso, `404` no existe, `409` conflicto de estado, `500` interno.
- Fechas en ISO 8601 UTC.
- IDs UUID.

---

## `auth/`

### `GET /api/sf/auth/me`

Devuelve el perfil del usuario autenticado y sus permisos en el sistema.

**Response 200:**
```json
{
  "user": {
    "id": "uuid",
    "email": "vip@merkahorrosas.com",
    "rol": "cliente_vip",
    "nombre": "Juan Pérez"
  },
  "permisos": {
    "puede_crear_sesion": true,
    "puede_cancelar_otros": false
  }
}
```

---

## `catalog/`

### `GET /api/sf/catalog/search`

Busca productos por nombre, EAN o `f120_id`. Devuelve agrupados por producto con sus presentaciones (`unidad_medida`).

**Query params:**
- `q` (string, required, min 2 chars) — texto de búsqueda
- `limit` (int, optional, default 20, max 50)

**Response 200:**
```json
{
  "results": [
    {
      "siesa_codigo": "12345",
      "descripcion": "MANGO TOMMY",
      "presentaciones": [
        { "unidad_medida": "KL",  "codigo_barras": null,        "requiere_peso": true  },
        { "unidad_medida": "UND", "codigo_barras": "7700001234", "requiere_peso": false }
      ]
    }
  ]
}
```

### `GET /api/sf/catalog/lookup`

Resuelve un único producto por código escaneado (EAN clásico o GS1-128).

**Query params:**
- `barcode` (string, required) — el barcode escaneado

**Response 200 (EAN clásico):**
```json
{
  "tipo": "ean",
  "producto": {
    "siesa_codigo": "12345",
    "descripcion": "POLLO ENTERO",
    "unidad_medida": "UND",
    "requiere_peso": false
  }
}
```

**Response 200 (GS1-128 con peso variable, prefijo 29):**
```json
{
  "tipo": "gs1",
  "producto": {
    "siesa_codigo": "98765",
    "descripcion": "CARNE RES",
    "unidad_medida": "KL",
    "requiere_peso": false
  },
  "peso_extraido_kg": 1.234,
  "gs1_raw": "29...".
}
```

**Response 404:**
```json
{ "error": { "code": "barcode-not-found", "message": "Código no registrado en el catálogo" } }
```

---

## `sessions/`

### `POST /api/sf/sessions`

Crea una nueva sesión vacía. Falla si el VIP ya tiene una `abierta` en esa sede.

**Body:**
```json
{
  "cliente_nota": "Sra. María — carrito azul"
}
```

**Response 201:**
```json
{
  "session": {
    "id": "uuid",
    "estado": "abierta",
    "vip_user_id": "uuid",
    "sede_id": "uuid",
    "total_items": 0,
    "cliente_nota": "Sra. María — carrito azul",
    "created_at": "2026-05-08T14:30:00Z"
  }
}
```

**Response 409:**
```json
{ "error": { "code": "session-already-open", "message": "Ya tenés una sesión abierta en esta sede", "details": { "session_id": "uuid" } } }
```

### `GET /api/sf/sessions/:id`

Devuelve una sesión con sus items.

**Response 200:**
```json
{
  "session": {
    "id": "uuid",
    "estado": "abierta",
    "total_items": 3,
    "cliente_nota": "Sra. María",
    "created_at": "2026-05-08T14:30:00Z",
    "items": [
      {
        "id": "uuid",
        "siesa_codigo": "12345",
        "nombre": "MANGO TOMMY",
        "unidad_medida": "KL",
        "cantidad": "0.500",
        "origen": "busqueda_manual",
        "created_at": "2026-05-08T14:31:12Z"
      }
    ]
  }
}
```

### `GET /api/sf/sessions`

Lista sesiones del VIP autenticado en la sede actual.

**Query params:**
- `estado` (optional) — filtra por estado
- `limit`, `offset` para paginación

**Response 200:**
```json
{
  "sessions": [ { "id": "uuid", "estado": "abierta", "total_items": 3, "...": "..." } ],
  "total": 12
}
```

### `POST /api/sf/sessions/:id/finalize`

Cierra la sesión (no se pueden agregar más items) y genera el QR.

**Response 200:**
```json
{
  "session": { "id": "uuid", "estado": "finalizada", "finalized_at": "..." },
  "qr": {
    "token": "eyJhbGc...",
    "expires_at": "2026-05-08T14:50:00Z",
    "ttl_seconds": 900,
    "payload_for_pos": {
      "v": 1,
      "session_id": "uuid",
      "items": [
        { "siesa_codigo": "12345", "unidad_medida": "KL",  "cantidad": "0.500" },
        { "siesa_codigo": "98765", "unidad_medida": "UND", "cantidad": "2"     }
      ]
    }
  }
}
```

> El frontend recibe `qr.token` y lo renderiza como QR. La caja escanea ese token. **El token NO contiene los items**: la caja debe llamar a `POST /api/sf/checkout/redeem` con el token para obtener el manifiesto. Esto evita QRs gigantes y permite invalidar tokens redimidos.
>
> `payload_for_pos` se incluye solo como referencia para mostrar en pantalla del VIP qué se va a cobrar.

**Response 409 (sesión vacía):**
```json
{ "error": { "code": "session-empty", "message": "No se puede finalizar una sesión sin items" } }
```

### `POST /api/sf/sessions/:id/cancel`

Cancela la sesión. Solo permitido si está `abierta`.

**Response 200:**
```json
{ "session": { "id": "uuid", "estado": "cancelada", "cancelled_at": "..." } }
```

---

## `items/`

### `POST /api/sf/sessions/:sessionId/items`

Agrega un item a la sesión. La sesión debe estar `abierta`.

**Body (scan EAN clásico):**
```json
{
  "siesa_codigo": "12345",
  "unidad_medida": "UND",
  "cantidad": "1",
  "origen": "scan_ean",
  "ean_escaneado": "7700001234"
}
```

**Body (scan GS1 con peso, carnicería):**
```json
{
  "siesa_codigo": "98765",
  "unidad_medida": "KL",
  "cantidad": "1.234",
  "origen": "scan_gs1",
  "ean_escaneado": "29...",
  "metadata": { "gs1_raw": "29..." }
}
```

**Body (búsqueda manual fruver con peso de báscula):**
```json
{
  "siesa_codigo": "12345",
  "unidad_medida": "KL",
  "cantidad": "0.500",
  "origen": "busqueda_manual"
}
```

**Response 201:**
```json
{ "item": { "id": "uuid", "...": "..." } }
```

**Validaciones:**
- `cantidad > 0`
- Si `unidad_medida` es de peso (`KL`, `LB`, `500GR`), `cantidad` puede ser decimal con hasta 3 decimales.
- Si `unidad_medida` es `UND`, `P6`, etc., `cantidad` debe ser entero.
- El producto debe existir en `siesa_codigos_barras`.

### `PATCH /api/sf/sessions/:sessionId/items/:itemId`

Edita la cantidad de un item.

**Body:**
```json
{ "cantidad": "0.750" }
```

**Response 200:**
```json
{ "item": { "id": "uuid", "cantidad": "0.750", "...": "..." } }
```

### `DELETE /api/sf/sessions/:sessionId/items/:itemId`

Quita un item.

**Response 204** (sin body)

---

## `checkout/` (consumido por la caja)

### `POST /api/sf/checkout/redeem`

Endpoint que **el POS de la caja consume** al escanear el QR. Valida el token, marca la sesión como `cobrada` y devuelve el manifiesto completo de items.

**Auth:** rol `caja` (a definir) o token de servicio. **NO requiere `X-Sede-ID`** (la sede sale de la sesión).

**Body:**
```json
{ "token": "eyJhbGc..." }
```

**Response 200:**
```json
{
  "session_id": "uuid",
  "sede_id": "uuid",
  "vip_user": { "id": "uuid", "nombre": "Juan Pérez" },
  "finalized_at": "2026-05-08T14:35:00Z",
  "items": [
    { "siesa_codigo": "12345", "nombre": "MANGO TOMMY", "unidad_medida": "KL",  "cantidad": "0.500" },
    { "siesa_codigo": "98765", "nombre": "CARNE RES",   "unidad_medida": "KL",  "cantidad": "1.234" },
    { "siesa_codigo": "11111", "nombre": "ARROZ 500G",  "unidad_medida": "UND", "cantidad": "3"     }
  ]
}
```

**Errores:**
- `401` token inválido o firma incorrecta
- `409 token-expired` token expirado
- `409 token-already-redeemed` ya fue cobrado (incluye `redeemed_at`)
- `404 token-not-found`

> ⚠️ **Decisión pendiente con el equipo POS:** confirmar el formato exacto que espera el lector de la caja. Este contrato es nuestra propuesta — adaptamos cuando tengan la spec.

---

## Errores transversales

| Code | HTTP | Significado |
|---|---|---|
| `validation-error` | 400 | El body no pasó Zod. `details` lista los campos. |
| `unauthorized` | 401 | Falta JWT o es inválido. |
| `forbidden` | 403 | El rol no tiene permiso. |
| `not-found` | 404 | Recurso no existe. |
| `session-already-open` | 409 | Ya hay una sesión abierta. |
| `session-not-editable` | 409 | Sesión no está `abierta`. |
| `session-empty` | 409 | Intento de finalizar sin items. |
| `barcode-not-found` | 404 | Barcode no registrado. |
| `token-expired` | 409 | QR vencido. |
| `token-already-redeemed` | 409 | QR ya cobrado. |
| `internal-error` | 500 | Error inesperado (logueado con request id). |
