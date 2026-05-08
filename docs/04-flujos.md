# 04 — Flujos del sistema

Diagramas detallados de los flujos críticos.

---

## Flujo 1 — Sesión completa (happy path)

```
VIP                Frontend            Backend SF           Supabase           Caja
 │                    │                    │                    │                │
 │ 1. login           │                    │                    │                │
 │───────────────────▶│                    │                    │                │
 │                    │ POST /auth/me      │                    │                │
 │                    │───────────────────▶│ valida JWT + rol   │                │
 │                    │                    │───────────────────▶│                │
 │                    │◀───────────────────│ user + permisos    │                │
 │                    │                    │                    │                │
 │ 2. "Iniciar carrito" │                  │                    │                │
 │───────────────────▶│ POST /sessions     │                    │                │
 │                    │───────────────────▶│ INSERT sf_sessions │                │
 │                    │                    │───────────────────▶│                │
 │                    │◀───────────────────│ session.id         │                │
 │                    │                    │                    │                │
 │ 3. escanea o busca │                    │                    │                │
 │   producto         │                    │                    │                │
 │───────────────────▶│ GET /catalog/lookup│                    │                │
 │                    │───────────────────▶│ SELECT desde       │                │
 │                    │                    │  siesa_codigos_    │                │
 │                    │                    │  barras            │                │
 │                    │◀───────────────────│ producto resuelto  │                │
 │                    │                    │                    │                │
 │   (si fruver →     │                    │                    │                │
 │    modal de peso)  │                    │                    │                │
 │                    │                    │                    │                │
 │                    │ POST /items        │                    │                │
 │                    │───────────────────▶│ INSERT sf_items    │                │
 │                    │◀───────────────────│ item creado        │                │
 │                    │                    │                    │                │
 │   (repetir 3 N veces)                   │                    │                │
 │                    │                    │                    │                │
 │ 4. "Finalizar"     │                    │                    │                │
 │───────────────────▶│ POST /sessions/:id │                    │                │
 │                    │   /finalize        │                    │                │
 │                    │───────────────────▶│ UPDATE estado      │                │
 │                    │                    │ + INSERT qr_token  │                │
 │                    │                    │ (HMAC firmado)     │                │
 │                    │◀───────────────────│ token + ttl        │                │
 │                    │ renderiza QR       │                    │                │
 │                    │                    │                    │                │
 │ 5. cliente va a caja con celular mostrando QR              │                  │
 │                                                            ▼                  │
 │                                                  6. caja escanea QR           │
 │                                                            │                  │
 │                                                            │ POST /checkout/  │
 │                                                            │   redeem         │
 │                                                            │─────────────────▶│
 │                                                            │ valida HMAC      │
 │                                                            │ + UPDATE         │
 │                                                            │   redeemed_at    │
 │                                                            │◀─────────────────│
 │                                                            │ manifiesto       │
 │                                                            │                  │
 │                                                  7. POS carga items y cobra   │
```

---

## Flujo 2 — Producto carnicería (etiqueta GS1-128)

Carnicería pesa el producto en mostrador, imprime una etiqueta con código GS1-128 que codifica:

- Prefijo `29` (peso variable)
- Código del producto (5 dígitos)
- Peso en gramos (5 dígitos)
- Check digit

Ejemplo: `29` + `98765` + `01234` + `5` = `29987650123 45`

### Flujo

```
1. VIP escanea etiqueta de carnicería con la cámara
2. Frontend → GET /catalog/lookup?barcode=29987650123 45
3. Backend detecta prefijo "29" → llama a gs1Utils.parseGS1()
4. Extrae:
     - siesa_codigo = "98765"
     - peso_gramos  = 1234
5. Resuelve producto en siesa_codigos_barras WHERE f120_id = '98765'
6. Devuelve:
     {
       tipo: "gs1",
       producto: { siesa_codigo: "98765", descripcion: "CARNE RES", unidad_medida: "KL" },
       peso_extraido_kg: 1.234
     }
7. Frontend muestra confirmación: "CARNE RES — 1.234 kg" → [Agregar]
8. POST /items con cantidad="1.234", origen="scan_gs1"
```

**Sin modal de peso.** El peso ya viene en el código.

---

## Flujo 3 — Producto fruver (sin etiqueta, con báscula digital)

La báscula del fruver muestra el peso en pantalla pero **no imprime etiqueta**. El empleado tiene que leer la pantalla y tipear.

### Flujo

```
1. VIP toca la lupa y busca: "mango"
2. Frontend → GET /catalog/search?q=mango
3. Backend devuelve presentaciones agrupadas:
     [
       {
         siesa_codigo: "12345",
         descripcion: "MANGO TOMMY",
         presentaciones: [
           { unidad_medida: "KL",  requiere_peso: true  },
           { unidad_medida: "UND", requiere_peso: false }
         ]
       }
     ]
4. Frontend muestra:
     ┌───────────────────────────┐
     │ MANGO TOMMY               │
     │ ¿Cómo lo lleva?           │
     │  [ Por kilo ]             │
     │  [ Por unidad ]           │
     └───────────────────────────┘
5a. Si elige "Por unidad":
     Modal de cantidad → "¿Cuántas unidades?" → tipea "3" → [Agregar]
     POST /items { unidad_medida: "UND", cantidad: "3", origen: "busqueda_manual" }
5b. Si elige "Por kilo":
     Modal de peso → "Peso de la báscula (kg):" → tipea "0.480" → [Agregar]
     Validación: 0 < cantidad <= 50  (alerta si fuera de rango)
     POST /items { unidad_medida: "KL", cantidad: "0.480", origen: "busqueda_manual" }
```

### Reglas del modal de peso

- Input numérico, decimal con punto (NO coma — luego mostramos según locale)
- Hasta 3 decimales
- Botones rápidos `0.250`, `0.500`, `1.000` para presets comunes
- Si peso > 30 kg → warning amarillo, requiere confirmación extra
- Si peso > 50 kg → bloqueado, error
- Si peso = 0 → bloqueado

### Edge cases

| Caso | Comportamiento |
|---|---|
| Producto solo se vende por unidad (no tiene `KL`) | Modal de unidad directo, no preguntamos |
| Producto solo se vende por peso | Modal de peso directo |
| Producto tiene `500GR` (medio kilo fijo) | Modal de cantidad de "medios kilos" → multiplica internamente |
| Empleado se equivoca en el peso | Edita desde la lista de items: tap en el item → cambiar cantidad |

---

## Flujo 4 — Producto seco con código de barras estándar (EAN)

Productos empacados con EAN-13 normal (arroz, gaseosa, etc.).

```
1. VIP escanea con la cámara
2. Frontend → GET /catalog/lookup?barcode=7700001234567
3. Backend detecta que NO empieza con "29" → busca en siesa_codigos_barras WHERE codigo_barras = '7700001234567'
4. Devuelve { tipo: "ean", producto: { ..., unidad_medida: "UND", requiere_peso: false } }
5. Frontend muestra: "ARROZ 500G — agregando 1 unidad" → [Confirmar] [+ otra]
6. POST /items { unidad_medida: "UND", cantidad: "1", origen: "scan_ean" }
```

**Sin modal.** Scan = +1 unidad. Si quiere 3 → tres scans, o edita la cantidad después.

---

## Flujo 5 — Generación y validación del QR

### Generación (al finalizar sesión)

```
1. Frontend → POST /sessions/:id/finalize
2. Backend:
   a. Valida que la sesión esté 'abierta' y tenga >= 1 item
   b. UPDATE sf_sessions SET estado='finalizada', finalized_at=now()
   c. Construye payload:
        { v: 1, sid: "<session_id>", iat: <unix_now>, exp: <unix_now + 900> }
   d. Firma con HMAC-SHA256 usando QR_SIGNING_SECRET:
        token = base64url(payload) + "." + base64url(hmac)
   e. INSERT sf_qr_tokens (session_id, token, expires_at)
   f. INSERT sf_audit_log action='qr.generated'
3. Devuelve { token, expires_at, ttl_seconds }
4. Frontend renderiza QR con la string `token`
```

### Validación (al redimir desde caja)

```
1. Caja → POST /checkout/redeem { token: "..." }
2. Backend:
   a. Parsea token: header.signature
   b. Valida HMAC: si no coincide → 401 unauthorized
   c. Decodifica payload, valida `exp` > now → si no → 409 token-expired
   d. SELECT sf_qr_tokens WHERE token = ?
      - Si no existe → 404 token-not-found (reemitido o falsificado)
      - Si redeemed_at IS NOT NULL → 409 token-already-redeemed
   e. SELECT sf_sessions WHERE id = payload.sid
   f. SELECT sf_items WHERE session_id = payload.sid
   g. UPDATE sf_qr_tokens SET redeemed_at = now() WHERE token = ?
   h. UPDATE sf_sessions SET estado='cobrada', redeemed_at=now()
   i. INSERT sf_audit_log action='qr.redeemed'
   j. Devuelve manifiesto completo
```

**Por qué firma + DB y no solo firma:**

- La firma garantiza que el token no fue falsificado.
- La fila en `sf_qr_tokens` permite **single-use** (si solo confiamos en la firma, el mismo QR se podría redimir dos veces).
- Permite invalidar tokens manualmente (re-finalize).

---

## Flujo 6 — Cancelación de sesión

```
1. VIP cancela desde el frontend
2. Frontend → POST /sessions/:id/cancel
3. Backend:
   a. Valida estado = 'abierta'  (sino 409 session-not-editable)
   b. UPDATE estado='cancelada', cancelled_at=now()
   c. INSERT sf_audit_log action='session.cancelled'
4. Items se mantienen en DB para auditoría (no DELETE).
```

---

## Flujo 7 — Re-finalize (caso de error)

A veces el QR no se ve bien, o la caja necesita uno nuevo.

```
1. VIP toca "Generar QR de nuevo" (solo disponible si estado='finalizada' y NO 'cobrada')
2. Frontend → POST /sessions/:id/finalize
3. Backend:
   a. Si estado='finalizada' y existe token NO redimido → invalida token anterior (DELETE o expires_at=now()) y emite uno nuevo
   b. Si estado='cobrada' → 409 session-not-editable
4. Devuelve nuevo token.
```

---

## Casos NO manejados en v1 (documentados para fases futuras)

| Caso | Decisión actual |
|---|---|
| El producto no está en `siesa_codigos_barras` | Mostramos error, sin alternativa. Futuro: pedir descripción manual y marcar para revisión. |
| Conexión cae en medio de una sesión | El frontend guarda items en IndexedDB y reintenta cuando vuelve. Pendiente diseñar conflict resolution. |
| Cliente cambia de opinión y devuelve productos en la caja | Lo maneja la caja en el POS, fuera del scope de Sin Filas. |
| Detección de fraude (escaneos sospechosos) | Out of scope v1. El audit log permite revisar a posteriori. |
