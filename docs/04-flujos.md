# 04 — Flujos del sistema (Lazy Sync)

Diagramas de los flujos críticos como están implementados HOY.

> El plan inicial usaba un flujo per-item (cada scan iba al backend). El proyecto pivoteó a **Lazy Sync**: el carrito se acumula 100% en el frontend y solo viaja al backend al finalizar.

---

## Flujo 1 — Sesión completa (happy path real)

```
VIP                 Frontend (sinFilas)        Backend SF          Supabase           Caja POS
 │                       │                          │                    │                │
 │ 1. abre /sin-filas    │                          │                    │                │
 │──────────────────────▶│                          │                    │                │
 │                       │ (no hay endpoint /me;    │                    │                │
 │                       │  cualquier empleado      │                    │                │
 │                       │  con la URL puede entrar)│                    │                │
 │                       │                          │                    │                │
 │ 2. escanea o busca    │                          │                    │                │
 │──────────────────────▶│ GET /catalog/search      │                    │                │
 │                       │─────────────────────────▶│ JOIN items_siesa + │                │
 │                       │                          │ siesa_codigos_     │                │
 │                       │                          │ barras WHERE active│                │
 │                       │                          │───────────────────▶│                │
 │                       │◀─────────────────────────│ productos agrupados│                │
 │                       │                          │  por f120_id       │                │
 │                       │                          │                    │                │
 │   (si fruver →        │                          │                    │                │
 │    modal de peso)     │                          │                    │                │
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
 │                       │─────────────────────────▶│ INSERT sf_sessions │                │
 │                       │                          │  (estado=          │                │
 │                       │                          │   'finalizado')    │                │
 │                       │                          │ INSERT sf_session_ │                │
 │                       │                          │  items (N filas)   │                │
 │                       │                          │ INSERT sf_qr_tokens│                │
 │                       │                          │  (uuid, no expira) │                │
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
```

**Diferencia crítica con el plan original:**

- El QR **NO contiene un token** que la caja resuelve contra el backend. Contiene **el manifiesto crudo** que el POS sabe leer (formato `QTY*CODE\r\n` o GS1 de 13 dígitos directo).
- El token en `sf_qr_tokens` es un UUID de auditoría: queda guardado pero la caja no lo usa.
- No hay endpoint que el POS llame de vuelta. La caja no se entera del backend de Sin Filas.

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
4. Frontend ve isGs1 → llama addItemToCart() directamente sin modal
     - codigo_barras que se guarda: el GS1 completo escaneado (los 13 chars)
     - cantidad: el peso embebido
5. Se acumula en el carrito local.
```

**Sin modal de peso.** El peso ya viene en el código.

---

## Flujo 3 — Producto fruver (sin etiqueta, con báscula)

La báscula del fruver muestra el peso en pantalla pero **no imprime etiqueta**. El VIP tiene que leer la pantalla y tipear.

### Flujo real

```
1. VIP toca la lupa → SFManualSearch → tipea "mango"
2. Frontend → GET /catalog/search?query=mango
3. Backend devuelve:
     [
       {
         f120_id: "12345",
         nombre: "MANGO TOMMY",
         presentaciones: [
           { codigo_barras: "2912345",       unidad_medida: "KL",  requiere_peso: true  },
           { codigo_barras: "7700001234567", unidad_medida: "UND", requiere_peso: false }
         ]
       }
     ]
4. SFPresentationModal muestra las opciones:
     ┌────────────────────────────┐
     │ MANGO TOMMY                │
     │  ┌────────────────────┐    │
     │  │ KL (Pesar)         │    │
     │  └────────────────────┘    │
     │  ┌────────────────────┐    │
     │  │ UND                │    │
     │  └────────────────────┘    │
     └────────────────────────────┘
5a. Si elige UND → addItemToCart() directo con cantidad=1.
5b. Si elige KL (requiere_peso) → SFWeightModal:
     - input numérico, step="0.001", min="0.001"
     - VIP tipea "0.480"
     - Submit → generateGs1Barcode("2912345", 0.480) genera el GS1 final
     - addItemToCart() con codigo_barras GS1 + cantidad=0.480
```

### Reglas del modal de peso (estado real)

| Caso | Comportamiento real |
|---|---|
| Validación mínima | `min="0.001"`, `required` |
| Validación máxima | No hay tope superior. **Pendiente.** |
| Decimales | `step="0.001"` (3 decimales) |
| Botones rápidos (0.250, 0.500, 1.000) | No implementado. **Pendiente.** |
| Edición de peso después de agregar | Hay que eliminar y volver a agregar. No hay PATCH. |

---

## Flujo 4 — EAN clásico (productos secos)

```
1. VIP escanea con la cámara
2. SFApp.handleScan() → GET /catalog/search?query=7700001234567
3. Backend NO detecta prefijo 29 → busca match exacto
4. Devuelve el producto con sus presentaciones (sin isGs1)
5. Si hay 1 sola presentación → SFApp.handlePresentationChoice() la usa directo
6. Si no requiere peso → addItemToCart() con cantidad=1
7. Si hay varias presentaciones → SFPresentationModal
```

**Sin modal.** Scan = +1 unidad. Si el producto YA está en el carrito y NO requiere peso → `cartStore` suma `cantidad += 1`.

---

## Flujo 5 — Generación del QR (sin firma)

```
1. VIP toca "Finalizar y Generar QR"
2. SFApp.handleFinalize():
   a. Llama a generateManifestQRValue(items) en gs1Utils.js:
        - Para items pesables (KL/LB/500GR/250GR) o GS1: línea = codigo_barras
        - Para items normales: línea = `${cantidad}*${codigo_barras}`
        - Une todo con "\r\n"
   b. Llama a finalizeCheckoutDirect(items, rawQrText)
3. Backend en sessions.controller.ts:
   a. INSERT sf_sessions (estado='finalizado')
   b. INSERT sf_session_items (N filas)
   c. INSERT sf_qr_tokens (token = crypto.randomUUID(), expires_at = '2099-12-31...')
   d. (NO usa raw_qr_string ni lo guarda)
4. Frontend pinta QRCodeSVG con value=rawQrText.
```

> ⚠️ Las inserciones NO son transaccionales. Si falla items o token, queda la sesión huérfana en BD. Es un gap conocido.

---

## Flujo 6 — Validación en la caja

Hoy NO existe endpoint de validación. El POS:

1. Escanea el QR
2. Recibe el string `"3*7700001234567\r\n2998765012345..."`
3. Lo parsea internamente (el POS YA sabe leer este formato del picking)
4. Carga las líneas en el ticket
5. Cobra

**El backend de Sin Filas no se entera de que la caja procesó el QR.** La columna `sf_qr_tokens.used_at` queda en `null` para siempre, y el dashboard admin muestra todas las sesiones como "PENDIENTE".

> Cuando se implemente `POST /sessions/:id/redeem` (o `POST /qr/redeem`), el POS le pegará al backend para marcar `used_at = now()` y mover la sesión a `estado='cobrado'`.

---

## Flujos NO implementados (pendientes)

| Flujo | Estado | Notas |
|---|---|---|
| Cancelación de sesión desde el dashboard | Pendiente | Falta endpoint y UI |
| Edición de items después de agregar | Pendiente | Hoy solo se puede eliminar |
| Sesión `en_proceso` con sync remoto | Pendiente | El default del ENUM es `en_proceso` pero no se usa hoy |
| Marca de `cobrado` cuando la caja redime | Pendiente | El POS no llama al backend |
| Modo offline real con IndexedDB | Parcial | Zustand persist guarda en localStorage; falta queue de reintento del POST |
| Audit log de eventos | Pendiente | Tabla `sf_audit_log` existe pero nadie escribe |

---

## Cómo "se ve" el manifiesto QR final

Para un carrito con 3 ARROZ 500G + 1 CARNE RES (1.234 kg) + 1 MANGO (0.480 kg):

```
3*7700001234567
2998765012345 (carne GS1, peso embebido)
2912345004806 (mango GS1 generado por el frontend)
```

(separados por `\r\n`)

El POS reconoce las líneas con `*` como `cantidad*codigo` y las líneas que arrancan con `29` como GS1 pesable.
