# 03 — API REST (estado real)

Base URL en producción: `https://backend-sin-filas.vercel.app/api/sf`.
Localmente: `http://localhost:3000/api/sf` (puerto 3000 por defecto).

> Este documento refleja **los endpoints que existen hoy en el código**. Lo que está marcado como _pendiente_ todavía no está implementado.

## Convenciones

- Todos los bodies y responses son JSON.
- Errores no estandarizados: hoy los controllers devuelven `{ error: "..." }` o `{ error: "...", detail: "..." }`.
- Códigos: `400` validación manual, `500` interno. No hay `401/403` (no hay auth implementada).
- Fechas en ISO 8601 UTC.
- IDs UUID.
- Auth: el frontend envía `Authorization: Bearer <jwt-supabase>` por interceptor (ver `sfApi.js`), **pero el backend NO lo valida hoy**.

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

Busca productos por nombre, EAN, GS1-128 o `f120_id`. Devuelve resultados agrupados por producto con sus presentaciones.

**Query params:**
- `query` (string, requerido) — texto de búsqueda.

**Comportamiento del backend (`catalog.controller.ts`):**

1. Si `query` es numérico y empieza con `29` y mide 13 chars → lo interpreta como GS1-128 con peso variable:
   - extrae `searchCode = "29" + dígitos 3-7` (SKU interno)
   - extrae `parsedGs1Weight = dígitos 8-12 / 1000` (kg)
   - busca `siesa_codigos_barras.codigo_barras LIKE '<searchCode>%'`
2. Si `query` es numérico (otros casos):
   - busca match exacto en `codigo_barras` o en `f120_id`
3. Si `query` no es numérico:
   - split por espacios y aplica un `ilike '%word%'` por palabra contra `f120_descripcion`

Resultado: join con `items_siesa` activo, agrupado por `f120_id`. Cada producto tiene una lista de `presentaciones` (1 por barcode + unidad_medida única).

**Response 200 (texto):**
```json
[
  {
    "f120_id": "12345",
    "nombre": "MANGO TOMMY",
    "presentaciones": [
      { "codigo_barras": "7700001234567", "unidad_medida": "UND", "requiere_peso": false },
      { "codigo_barras": "2912345",       "unidad_medida": "KL",  "requiere_peso": true  }
    ]
  }
]
```

**Response 200 (GS1-128 con peso embebido):**
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

**Reglas de `requiere_peso`:**

```ts
requiere_peso = ['KL', 'LB', '500GR', '250GR', 'PZ'].includes(unidad_medida)
              || codigo_barras.startsWith('29');
```

**Response 400:**
```json
{ "error": "El parámetro \"query\" es requerido" }
```

**Response 500:**
```json
{ "error": "Error consultando catalogo", "detail": "<mensaje>" }
```

---

## `sessions/`

### `POST /api/sf/sessions/checkout-direct`

Crea la sesión y todos sus items de una sola vez (Lazy Sync). Inserta también un token QR sin expiración.

**Body:**
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
  "vip_user_id": "uuid-opcional",
  "sede_id": "uuid-opcional",
  "raw_qr_string": "3*7700001234567\r\n2998765012345"
}
```

**Notas importantes:**

- `vip_user_id` y `sede_id` son opcionales hoy. Si no llegan → caen a `'00000000-0000-0000-0000-000000000000'` (placeholder).
- `raw_qr_string` se acepta pero **NO se guarda**: el frontend lo arma con `generateManifestQRValue()` y lo pinta en pantalla. El backend solo persiste la sesión y un UUID como token.
- El estado de la sesión se inserta directo como `'finalizado'`.
- `total_items` = `items.length` (cantidad de líneas, no suma de cantidades).

**Pipeline:**

1. `INSERT INTO sf_sessions (vip_user_id, sede_id, estado='finalizado', total_items)`
2. `INSERT INTO sf_session_items (...)` con todos los items
3. `INSERT INTO sf_qr_tokens (session_id, token=uuid, expires_at='2099-12-31T23:59:59Z')`

> ⚠️ Las 3 inserciones **NO están en una transacción**. Si falla la segunda o tercera, queda una sesión huérfana en BD.

**Response 201:**
```json
{
  "session_id": "uuid",
  "success": true
}
```

**Response 400:**
```json
{ "error": "El carrito no puede estar vacío" }
```

**Response 500:**
```json
{ "error": "<mensaje>" }
```

---

## `admin/`

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
- `totalItems` = `sum(cantidad)` de `sf_session_items` (sumado en memoria, no en SQL).
- `activeVips` = cantidad de `vip_user_id` únicos en `sf_sessions`.

### `GET /api/sf/admin/sessions`

Últimas 50 sesiones con su token QR asociado.

**Response 200:**
```json
[
  {
    "id": "uuid",
    "estado": "finalizado",
    "total_items": 12,
    "created_at": "2026-05-08T14:30:00Z",
    "vip_user_id": "uuid",
    "sede_id": "uuid",
    "sf_qr_tokens": [
      { "used_at": null }
    ]
  }
]
```

- `sf_qr_tokens[0].used_at != null` → caja ya cobró este QR. Hoy siempre es `null` (no hay endpoint que lo marque).
- El frontend hace lookup contra `/admin/users` para resolver el nombre del VIP.

### `GET /api/sf/admin/users`

Listado plano de usuarios. **No filtra por rol** — devuelve todos los `profiles`.

**Response 200:**
```json
[
  { "user_id": "uuid", "nombre": "Juan Pérez", "correo": "juan@merkahorrosas.com", "role": "admin" },
  { "user_id": "uuid", "nombre": "María García", "correo": "maria@merkahorrosas.com", "role": "sf_vip" }
]
```

> Decisión de producto: cualquier empleado puede usar Sin Filas en días de alta carga, no se restringe a `sf_vip`.

---

## Errores

Hoy NO hay un mapper de errores centralizado. Cada controller hace su `try/catch` y devuelve:

| Caso | HTTP | Body |
|---|---|---|
| Falta `query` en catálogo | 400 | `{ error: "El parámetro \"query\" es requerido" }` |
| Carrito vacío en checkout | 400 | `{ error: "El carrito no puede estar vacío" }` |
| Cualquier error de Supabase | 500 | `{ error: "<msg supabase>" }` o `{ error: "...", detail: "..." }` |

---

## Pendiente / Roadmap de la API

| Endpoint | Estado | Notas |
|---|---|---|
| `POST /sessions/:id/redeem` | **Pendiente** | El POS necesita un endpoint para marcar `sf_qr_tokens.used_at = now()` y la sesión como `cobrado`. Hoy el dashboard espera ese estado pero nadie lo escribe. |
| Auth middleware (JWT Supabase) | **Pendiente** | Validar `Authorization: Bearer ...`, extraer `user_id` para `vip_user_id`. Hoy se acepta cualquier llamada anónima. |
| Validación Zod en bodies | **Pendiente** | Sólo `env.ts` usa Zod. Los controllers reciben `req.body` crudo. |
| Escritura en `sf_audit_log` | **Pendiente** | La tabla existe, falta conectarla. |
| Endpoint `GET /sessions/:id` | **Pendiente** | Hoy no se puede recuperar una sesión por ID con sus items. |
| Endpoint `POST /sessions/:id/cancel` | **Pendiente** | Para marcar como `cancelado` desde el dashboard. |
| Transacción en `checkout-direct` | **Pendiente** | Hoy las 3 inserciones son independientes; un fallo deja datos huérfanos. |
| Rate limiting en `/admin/*` | **Pendiente** | Sin protección. |
