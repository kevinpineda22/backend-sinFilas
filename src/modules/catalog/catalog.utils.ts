/**
 * Unidades de medida que requieren peso. Si la presentación tiene una de
 * estas, el frontend abre el modal de peso y arma el GS1 final con peso
 * embebido a partir del código base.
 */
const WEIGHABLE_UNITS = ['KL', 'LB', '500GR', '250GR', 'PZ'];

/**
 * Normaliza un `codigo_barras` de SIESA a su forma FÍSICA, quitando los
 * marcadores internos que NUNCA deben salir de la API (ni al QR, ni al
 * carrito, ni al registro):
 *
 *  - Prefijo `M` (master/multipack interno): `M7506105606060` → `7506105606060`.
 *    Es literalmente `M` + el EAN-13 que lee la cámara.
 *  - Sufijo `+` (venta abierta interna): `185325+` → `185325`.
 *
 * Estos códigos se siguen usando para el LOOKUP del producto (encontrar el
 * `f120_id`), pero jamás deben devolverse tal cual como presentación.
 */
export const normalizeBarcode = (codigo: string): string => {
  let c = codigo;
  // Prefijo M solo cuando precede a un dígito (es el marcador interno, no un
  // código que de casualidad empiece con M).
  if (/^M\d/.test(c)) c = c.slice(1);
  if (c.endsWith('+')) c = c.slice(0, -1);
  return c;
};

/**
 * Cuántas unidades base contiene una presentación. SIESA cobra el precio por
 * el `f120_id` (SKU base = 1 unidad), pero un mismo SKU se vende también en
 * paquetes: `P15` = cubeta de 15, `P30` = cartón de 30, `P6` = sixpack, etc.
 *
 * Devuelve el multiplicador para obtener el precio de la presentación a partir
 * del precio base:  precio_presentacion = precio_base × unitsPerPresentation(um).
 *
 *  - `P<n>` (P2, P6, P15, P30...) → n   (paquete de n unidades)
 *  - `UND`, `KL`, `LB`, pesables, o cualquier otra → 1
 *
 * Los pesables (KL/LB) devuelven 1 a propósito: ahí el precio es POR KILO y la
 * "cantidad" del carrito es el peso (0.515), no un multiplicador de paquete.
 */
export const unitsPerPresentation = (unidadMedida: string | null | undefined): number => {
  if (!unidadMedida) return 1;
  const match = /^P(\d+)$/.exec(unidadMedida.trim().toUpperCase());
  if (!match) return 1;
  const n = parseInt(match[1], 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
};

/**
 * Decide si una "presentación" (fila de `siesa_codigos_barras`) es útil para
 * mostrarse al usuario cuando busca por TEXTO (no por escaneo).
 *
 * Reglas:
 *
 *  Para presentaciones PESABLES (KL/LB/500GR/250GR/PZ):
 *    Solo se acepta el **código GS1 corto** (`29` + 4 a 6 dígitos, ej `2900061`).
 *    Es el único formato que el frontend puede convertir en GS1 de 13 dígitos
 *    con peso embebido y check digit. Cualquier otro código pesable se filtra
 *    para evitar que el peso se pierda camino al POS.
 *
 *  Para presentaciones NO PESABLES (UND, P6, P25, P12, P24...):
 *    El código debe **terminar con su `unidad_medida`** (ej: `185325UND`,
 *    `185325P25`, `187825P6`). Son los códigos internos por presentación.
 *
 *  Se descartan en cualquier caso:
 *    - EAN-13 puros (códigos físicos del fabricante).
 *    - Códigos con prefijo `M` (multipack/master interno).
 *    - Códigos con sufijo `+` (variante interna de venta abierta).
 *    - SKUs "pelados" sin sufijo de presentación.
 *    - Códigos cortos locales (ej `61`).
 *
 * Esta función NO se aplica para escaneos / tipeo de código exacto (query
 * numérica): allí se devuelven todas las coincidencias para match físico.
 */
export const isManualSearchPresentation = (
  codigo: string | null | undefined,
  unidadMedida: string | null | undefined,
): boolean => {
  if (!codigo) return false;

  const isWeighable = !!unidadMedida && WEIGHABLE_UNITS.includes(unidadMedida);

  if (isWeighable) {
    // Único formato aceptado para pesables: GS1 corto, listo para que el
    // frontend le concatene peso + check digit.
    return /^29\d{4,6}$/.test(codigo);
  }

  // No pesables: debe terminar con la unidad de medida.
  if (!unidadMedida) return false;
  return codigo.endsWith(unidadMedida);
};
