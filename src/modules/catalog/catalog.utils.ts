/**
 * Unidades de medida que requieren peso. Si la presentación tiene una de
 * estas, el frontend abre el modal de peso y arma el GS1 final con peso
 * embebido a partir del código base.
 */
const WEIGHABLE_UNITS = ['KL', 'LB', '500GR', '250GR', 'PZ'];

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
