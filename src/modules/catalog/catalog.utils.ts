/**
 * Utilidades del catálogo.
 *
 * ⚠️ Las reglas de códigos de barras NO se implementan acá: viven en
 * `src/shared/qr/codigos.ts`, que es gemelo de `src/shared/qr/codigos.js` del
 * frontend y está pineado por `tests/shared/qr/contrato.test.ts`.
 *
 * Este archivo tenía su propia `normalizeBarcode` y su propia lista de
 * pesables, y las dos habían divergido de las del frontend:
 *
 *   - No sacaba el prefijo `N` (el frontend sí), así que un código `N7702…`
 *     salía de la API con una letra que el lector físico nunca ve.
 *   - No hacía `trim`/`toUpperCase`, así que ` 185325p25 ` y `185325P25` eran
 *     códigos distintos de este lado e iguales del otro.
 *   - `WEIGHABLE_UNITS.includes(um)` comparaba crudo: una unidad guardada como
 *     `"kl"` no se reconocía como pesable acá mientras el frontend sí la
 *     reconocía, y las dos mitades del sistema clasificaban el mismo producto
 *     de forma distinta.
 */

import { esUnidadPesable, limpiarCodigo, normalizarCodigo } from '../../shared/qr/codigos';

export { esUnidadPesable };

/**
 * Normaliza un `codigo_barras` de SIESA a su forma FÍSICA, quitando los
 * marcadores internos que NUNCA deben salir de la API (ni al QR, ni al
 * carrito, ni al registro):
 *
 *  - Prefijo `M`/`N` seguido de dígito (master/multipack interno):
 *    `M7506105606060` → `7506105606060`. Es literalmente la letra + el EAN-13
 *    que lee la cámara.
 *  - Sufijo `+` (venta abierta interna): `185325+` → `185325`.
 *
 * Estos códigos se siguen usando para el LOOKUP del producto (encontrar el
 * `f120_id`), pero jamás deben devolverse tal cual como presentación.
 */
export const normalizeBarcode = (codigo: string): string => limpiarCodigo(codigo);

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
 *
 * ⚠️ Gemela de `unitsPerPresentation` en `sinFilas/utils/priceUtils.js`.
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
 *    - SKUs "pelados" sin sufijo de presentación.
 *    - Códigos cortos locales (ej `61`).
 *
 * Esta función NO se aplica para escaneos / tipeo de código exacto (query
 * numérica): allí se devuelven todas las coincidencias para match físico.
 *
 * ⚠️ Gemela de `isPresentablePresentation` en
 * `sinFilas/components/SFProductModals.jsx`.
 */
export const isManualSearchPresentation = (
  codigo: string | null | undefined,
  unidadMedida: string | null | undefined,
): boolean => {
  if (!codigo) return false;

  if (esUnidadPesable(unidadMedida)) {
    // Único formato aceptado para pesables: GS1 corto, listo para que el
    // frontend le concatene peso + check digit.
    return /^29\d{4,6}$/.test(normalizarCodigo(codigo));
  }

  // No pesables: debe terminar con la unidad de medida. Se compara en la forma
  // canónica: si el código viene en mayúsculas y la unidad no (o al revés), el
  // `endsWith` crudo fallaba y la presentación desaparecía del buscador.
  if (!unidadMedida) return false;
  return normalizarCodigo(codigo).endsWith(normalizarCodigo(unidadMedida));
};
