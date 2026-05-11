# 04 — Flujos del sistema (Lazy Sync)

Diagramas de los flujos críticos como están implementados HOY.

---

## Flujo 0 — Entrada a Sin Filas (selección de sede)

Toda sesión necesita una sede concreta. Al entrar a `/sin-filas`, el frontend resuelve qué sede usar:

```
1. SFApp monta → llama a useSFSede()
2. useSFSede carga lista de wc_sedes activas (Supabase directo desde el browser).
3. Resolución de sede inicial:
     a) Si localStorage.sf_sede_id es UUID válido y existe en wc_sedes → usar esa.
     b) Sino, si localStorage.ecommerce_sede_id es UUID válido → usar esa
        (caso: empleado con sede asignada en `profiles` viniendo del ecommerce).
     c) Sino → renderiza <SFSedeSelector />.
4. SFSedeSelector muestra una lista de botones (uno por sede activa).
5. Al tocar una, se persiste en localStorage.sf_sede_id y se renderiza SFAppInner.
```

Una vez seleccionada, el header del SFApp muestra una barra:

```
┌──────────────────────────────────────────┐
│ SEDE: MerkahorroSAS Sur     [Cambiar]   │
└──────────────────────────────────────────┘
```

Tocar **Cambiar** vuelve al selector. Esto cubre al super_admin que opera en varias sedes y a los empleados con sede asignada.

---

## Flujo 1 — Sesión completa (happy path real)

```
VIP                 Frontend (sinFilas)        Backend SF          Supabase           Caja POS
 │                       │                          │                    │                │
 │ 1. abre /sin-filas    │                          │                    │                │
 │──────────────────────▶│ (gate de sede; ver       │                    │                │
 │                       │  flujo 0 si hace falta)  │                    │                │
 │                       │                          │                    │                │
 │ 2. escanea o busca    │                          │                    │                │
 │──────────────────────▶│ GET /catalog/search      │                    │                │
 │                       │  ?query=...              │                    │                │
 │                       │─────────────────────────▶│ JOIN items_siesa + │                │
 │                       │                          │ siesa_codigos_     │                │
 │                       │                          │ barras WHERE activo│                │
 │                       │                          │───────────────────▶│                │
 │                       │◀─────────────────────────│ productos agrupados│                │
 │                       │                          │ con filtro de      │                │
 │                       │                          │ presentaciones     │                │
 │                       │                          │ útiles             │                │
 │                       │                          │                    │                │
 │   (si pesable → modal │                          │                    │                │
 │    de gramos)         │                          │                    │                │
 │                       │ addItem() al cartStore   │                    │                │
 │                       │ (Zustand persist)        │                    │                │
 │                       │                          │                    │                │
 │   (repetir 2 N veces, todo offline-friendly)     │                    │                │
 │                       │                          │                    │                │
 │ 3. "Finalizar y       │                          │                    │                │
 │     Generar QR"       │                          │                    │                │
 │──────────────────────▶│ genera raw QR string     │                    │                │
 │                       │ con generateManifestQR-  │                    │                │
 │                       │ Value(items)             │                    │                │
 │                       │                          │                    │                │
 │                       │ POST /sessions/          │                    │                │
 │                       │      checkout-direct     │                    │                │
 │                       │ Authorization: Bearer ↗  │                    │                │
 │                       │ X-Sede-ID: <uuid> ↗      │                    │                │
 │                       │─────────────────────────▶│ requireAuth →      │                │
 │                       │                          │   valida JWT,      │                │
 │                       │                          │   req.user.id      │                │
 │                       │                          │ requireSede →      │                │
 │                       │                          │   req.sedeId       │                │
 │                       │                          │ Zod body valida    │                │
 │                       │                          │ items[*]           │                │
 │                       │                          │                    │                │
 │                       │                          │ INSERT sf_sessions │                │
 │                       │                          │  (vip_user_id =    │                │
 │                       │                          │   req.user.id,     │                │
 │                       │                          │   sede_id =        │                │
 │                       │                          │   req.sedeId,      │                │
 │                       │                          │   estado =         │                │
 │                       │                          │   'finalizado')    │                │
 │                       │                          │ INSERT sf_session_ │                │
 │                       │                          │  items (N filas)   │                │
 │                       │                          │ INSERT sf_qr_tokens│                │
 │                       │                          │  (uuid, no expira) │                │
 │                       │                          │ logAudit:          │                │
 │                       │                          │  session.finalized │                │
 │                       │                          │  qr.generated      │                │
 │                       │                          │───────────────────▶│                │
 │                       │◀─────────────────────────│ { session_id,      │                │
 │                       │                          │   success: true }  │                │
 │                       │                          │                    │                │
 │                       │ pinta QR con             │                    │                │
 │                       │ <QRCodeSVG value=        │                    │                │
 │                       │  rawQrValue>             │                    │                │
 │                       │                          │                    │                │
 │ 4. cliente va a caja con el celular mostrando el QR                   │                │
 │                                                                       ▼                │
 │                                                              5. POS escanea QR         │
 │                                                                       │                │
 │                                                                       │ lee el string  │
 │                                                                       │ crudo:         │
 │                                                                       │ "3*7700001234  │
 │                                                                       │  \r\n          │
 │                                                                       │  2998765012345"│
 │                                                                       │                │
 │                                                              6. POS carga al ticket    │
 │                                                                 línea por línea y cobra│
 │                                                                       │                │
 │                                                              7. (opcional) POS llama   │
 │                                                                 POST /sessions/:id/    │
 │                                                                 redeem para marcar     │
 │                                                                 used_at + 'cobrado'    │
```

**Diferencias con el plan original:**

- El QR contiene el manifiesto **crudo**, no un token que la caja resuelve contra el backend.
- El backend ya tiene auth real (JWT Supabase) y sede obligatoria por sesión.
- El endpoint `/redeem` existe para que el POS marque la sesión como cobrada, pero su uso es opcional desde el lado del POS.

---

## Flujo 2 — Producto carnicería (etiqueta GS1-128)

Carnicería pesa el producto y lo etiqueta con un código GS1-128 que codifica:

- Prefijo `29` (peso variable)
- Código del producto (5 dígitos)
- Peso en gramos (5 dígitos)
- Check digit (1 dígito)

Ejemplo: `29` + `98765` + `01234` + `5` = `29987650123 45` (13 chars).

### Flujo real

```
1. VIP escanea con la cámara (EscanerBarras del picking)
2. SFApp.handleScan(decodedText) → llama a searchCatalog(decodedText)
3. Backend en catalog.controller.ts:
     - detecta que arranca con "29" y tiene 13 chars
     - extrae searchCode = "29" + chars 3..7   (ej. "2998765")
     - extrae parsedGs1Weight = chars 8..12 / 1000   (ej. 1.234 kg)
     - busca presentaciones que matcheen "2998765%"
     - devuelve el producto con scanned_quantity=1.234, isGs1=true
     - (búsqueda numérica: NO aplica el filtro de presentaciones útiles)
4. Frontend ve isGs1 → llama addItemToCart() directamente sin modal
     - codigo_barras que se guarda: el GS1 completo escaneado (los 13 chars)
     - cantidad: el peso embebido
5. Se acumula en el carrito local.
```

**Sin modal de peso.** El peso ya viene en el código.

---

## Flujo 3 — Producto fruver (sin etiqueta, con báscula)

La báscula del fruver muestra el peso en pantalla pero **no imprime etiqueta**. El VIP tiene que leer la pantalla y tipear los gramos.

### Flujo real (ejemplo item 5073 PAPAYA)

Catálogo SIESA para 5073: `0050730050730, 5073+, 50730050730, 61, 5073KL, 2900061`.

```
1. VIP toca la lupa → SFManualSearch → tipea "papaya"
2. Frontend → GET /catalog/search?query=papaya
3. Backend devuelve (con filtro):
     [
       {
         f120_id: "5073",
         nombre: "PAPAYA",
         presentaciones: [
           { codigo_barras: "2900061", unidad_medida: "KL", requiere_peso: true }
         ]
       }
     ]
   (solo aparece el GS1 corto; los otros 5 códigos se descartan)
4. Como hay una sola presentación, SFApp.handleProductSelect llama directo
   a handlePresentationChoice() con la única opción → abre SFWeightModal.
5. SFWeightModal pide gramos enteros:
     ┌─────────────────────────────────┐
     │ Registrar Peso                  │
     │ PAPAYA (KL)                     │
     │ Ingresá el peso en gramos.      │
     │ Ej: 1 kilo = 1000.              │
     │                                 │
     │  ┌──────────────────────┐       │
     │  │       480       g    │       │
     │  └──────────────────────┘       │
     │                                 │
     │  [Cancelar]   [Agregar]         │
     └─────────────────────────────────┘
6. Submit → onSubmit(480).
7. SFApp.handleWeightSubmit(480):
     - weightKg = 480 / 1000 = 0.480
     - codigo_barras = "2900061" → startsWith('29') → true
     - finalBarcode = generateGs1Barcode("2900061", 0.480) =
         "2900061" + "00480" + checkDigit (13 chars)
     - addItemToCart con codigo_barras = GS1 final, cantidad = 0.480
```

### Reglas del modal de peso (estado real)

| Caso | Comportamiento real |
|---|---|
| Validación mínima | `min="1"` (gramo), `required` |
| Validación máxima | No hay tope superior. Pendiente. |
| Decimales | `step="1"` (gramos enteros, sin decimales) |
| Botones rápidos (250 / 500 / 1000) | No implementado. Pendiente. |
| Edición de peso después de agregar | Hay que eliminar y volver a agregar. No hay PATCH. |

---

## Flujo 4 — EAN clásico (productos secos)

```
1. VIP escanea con la cámara
2. SFApp.handleScan() → GET /catalog/search?query=7700001234567
3. Backend NO detecta prefijo 29 → busca match exacto
4. Devuelve el producto con sus presentaciones (sin filtro porque es numérica)
5. Si hay 1 sola presentación → SFApp.handlePresentationChoice() la usa directo
6. Si no requiere peso → addItemToCart() con cantidad=1
7. Si hay varias presentaciones → SFPresentationModal
```

**Sin modal.** Scan = +1 unidad. Si el producto YA está en el carrito y NO requiere peso → `cartStore` suma `cantidad += 1`.

---

## Flujo 5 — Búsqueda por texto y filtro de presentaciones útiles

Cuando el usuario tipea texto en `SFManualSearch`, el backend devuelve **solo** las presentaciones útiles para selección manual:

### Caso arroz (item 185326)

Catálogo SIESA: `185325+, 185326, 7709138700037, M7709138700037, 185325P25, 185325UND`.

Buscador devuelve solo:
- `185325UND` con unidad `UND`
- `185325P25` con unidad `P25`

### Caso cerveza (item 187825)

Catálogo SIESA: `187825+, 7707311662905, 7707311662929, M7707311662905, M7707311662929, 187825P6, 187825UND`.

Buscador devuelve solo:
- `187825UND` con unidad `UND`
- `187825P6` con unidad `P6`

### Caso fruver (item 5073)

Catálogo SIESA: `0050730050730, 5073+, 50730050730, 61, 5073KL, 2900061`.

Buscador devuelve solo:
- `2900061` con unidad `KL` (GS1 corto)

`5073KL` se descarta aunque termine en `KL`: regla para pesables exige `^29\d{4,6}$` para que el frontend pueda generar el GS1 con peso.

### Cuándo NO se aplica el filtro

- Búsqueda numérica (escaneo o tipeo de código): se devuelve cualquier match exacto.
- GS1 con peso embebido (`29XXXXX01234D`, 13 chars): se devuelve la presentación correspondiente sin filtrar.

---

## Flujo 6 — Generación del QR

```
1. VIP toca "Finalizar y Generar QR"
2. SFApp.handleFinalize():
   a. Llama a generateManifestQRValue(items) en gs1Utils.js:
        - Para items pesables (KL/LB/500GR/250GR) o GS1: línea = codigo_barras
        - Para items normales: línea = `${cantidad}*${codigo_barras}`
        - Une todo con "\r\n"
   b. Llama a finalizeCheckoutDirect(items, rawQrText)
3. Backend en sessions.controller.ts:
   a. INSERT sf_sessions (vip_user_id, sede_id, estado='finalizado')
   b. INSERT sf_session_items (N filas)
   c. INSERT sf_qr_tokens (token = crypto.randomUUID(), expires_at = '2099-12-31...')
   d. logAudit('session.finalized')
   e. logAudit('qr.generated')
   f. Si falla b o c → DELETE sf_sessions (rollback CASCADE) + logAudit('session.rollback')
4. Frontend pinta QRCodeSVG con value=rawQrText.
```

---

## Flujo 7 — Validación en la caja + redeem

Hoy el POS lee la string cruda del QR y la procesa como si fuera el formato del picking. Adicionalmente puede (opcionalmente) marcar la sesión como cobrada:

```
1. POS escanea QR del celular.
2. POS parsea el string interno y carga el ticket.
3. (Opcional) POS hace POST /api/sf/sessions/<session_id>/redeem
     - Backend marca sf_qr_tokens.used_at = now()
     - Backend pasa sf_sessions.estado a 'cobrado'
     - Audit log: qr.redeemed
4. El dashboard admin refleja "Cobrado en Caja: SÍ".
```

Si el POS NO llama al redeem, la sesión queda `finalizado` para siempre y el dashboard la muestra como PENDIENTE.

---

## Flujos NO implementados (pendientes)

| Flujo | Estado | Notas |
|---|---|---|
| Cancelación de sesión desde el dashboard | Pendiente | Falta endpoint y UI |
| Edición de items después de agregar | Pendiente | Hoy solo se puede eliminar |
| Sesión `en_proceso` con sync remoto | Pendiente | El default del ENUM es `en_proceso` pero no se usa hoy |
| Modo offline robusto con queue de reintento | Parcial | Zustand persist guarda en localStorage; falta queue para reintento del POST |
| Filtro por sede en `/admin/*` | Diferido | Se difiere a la fase del dashboard avanzado |
| Auth en `/admin/*` y en `/redeem` | Pendiente | Hoy abiertos |

---

## Cómo "se ve" el manifiesto QR final

Para un carrito con 3 ARROZ 500G (UND) + 1 CARNE RES (GS1 1.234 kg) + 1 PAPAYA (GS1 0.480 kg):

```
3*185325UND
29987650123 45  (carne, GS1 con peso embebido)
2900061004806   (papaya, GS1 generado por el frontend a partir de "2900061" + 0.480 kg)
```

(separados por `\r\n`)

El POS reconoce:
- Líneas con `*`: `cantidad*codigo`.
- Líneas que arrancan con `29` y miden 13 chars: GS1 pesable con peso embebido.
