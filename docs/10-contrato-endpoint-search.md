# Contrato — `GET /api/sf/catalog/search`

El endpoint **ya distingue** "no existe" de "error de conexión" por **status code**. El frontend NO debe tratar ambos como "Producto no encontrado": esa es la causa del síntoma reportado en [`09-bug-busqueda-codigo-barras.md`](./09-bug-busqueda-codigo-barras.md). El backend está correcto; el fix es leer el status.

## Lo único que hay que recordar

| Status | Significado | Qué muestra el frontend |
|--------|-------------|--------------------------|
| `200` + array con items | Hay coincidencias | La lista de productos |
| `200` + `[]` | El código/texto **no existe** en el catálogo | "Producto no encontrado" |
| `400` | La query es inválida (bug del cliente) | Mensaje de validación |
| `500` | Falló la consulta a la BD (**error de conexión**) | "Error, reintentá" — **NO** "no encontrado" |

> La distinción clave: `200 []` es una respuesta **exitosa** que significa "buscamos y no hay". `500` significa "no pudimos buscar". Son estados distintos y deben verse distinto.

## Request

```
GET /api/sf/catalog/search?query=<texto>
```

- `query`: string, **2 a 100** caracteres (se hace `trim`). Fuera de rango → `400`.
- Acepta código de barras escaneado, SKU tipeado o texto libre. El escáner manda solo el código (sin sufijo de unidad).

## Respuestas

### `200 OK` — éxito (con o sin resultados)

Array de productos. **Puede venir vacío** (`[]`) y eso es válido: significa "no existe".

```jsonc
[
  {
    "f120_id": 553,
    "nombre": "ACEITE OLEOSABOR 1000 ML",
    "presentaciones": [
      { "codigo_barras": "7702109017103", "unidad_medida": "UND", "requiere_peso": false }
    ]
  }
]
```

Campos extra **solo** en GS1 pesable (query de 13 dígitos que empieza en `29`):

```jsonc
{
  "f120_id": 1234,
  "nombre": "BANANO",
  "presentaciones": [ /* ... */ ],
  "scanned_quantity": 1.250,   // peso leído del código GS1 (kg)
  "isGs1": true
}
```

### `400 Bad Request` — query inválida

```jsonc
{
  "error": "validation-error",
  "message": "Código o búsqueda no válidos",
  "detail": ["La búsqueda requiere al menos 2 caracteres"]
}
```

### `500 Internal Server Error` — la consulta falló

```jsonc
{
  "error": "catalog-query-failed",      // o "internal-server-error"
  "message": "No se pudo consultar el catálogo",
  "detail": "<mensaje técnico>"
}
```

## Checklist para el frontend

- [ ] Ramear por **status code**, no por longitud del array.
- [ ] `200` + `[]` → "Producto no encontrado" (no es un error).
- [ ] `500` → mensaje de error/reintento, distinto de "no encontrado".
- [ ] `400` → revisar la query antes de mandarla (mínimo 2 caracteres).
- [ ] En GS1 pesable, usar `scanned_quantity` y `isGs1` si vienen.

## Nota de implementación (backend)

El control de estados vive en `src/modules/catalog/catalog.controller.ts`:
- `200 []` cuando el lookup no encuentra `f120_id` (`:74-78`) o cuando hay cast-error de un código que no cabe en INT4 (`:117-125`).
- `500` ante fallo real de Supabase (`:63-71`, `:127-133`) o excepción inesperada (`:193-200`).
