/**
 * VERIFICACIÓN DEL QR CONTRA `siesa_codigos_barras`.
 *
 * ══════════════════════════════════════════════════════════════════
 * POR QUÉ ESTO VIVE EN EL BACKEND
 * ══════════════════════════════════════════════════════════════════
 *
 * El QR lo arma el frontend, que es quien tiene el carrito. Pero el frontend
 * solo puede probar un código por PROCEDENCIA: "este código me lo devolvió
 * `searchCatalog`, así que salió de SIESA". Es una garantía buena, y es más
 * débil que mirar la tabla.
 *
 * El backend tiene la tabla delante. Acá se comprueba lo que la caja realmente
 * exige: que exista la fila. Es la misma regla que blinda el picking de
 * ecommerce (`buildManifestCode` contra `siesa_codigos_barras`).
 *
 * ══════════════════════════════════════════════════════════════════
 * NO BLOQUEA. NUNCA.
 * ══════════════════════════════════════════════════════════════════
 *
 * El resultado se guarda y se devuelve al frontend para que la pantalla lo
 * muestre junto al QR, pero el checkout se registra igual. Un falso negativo
 * acá dejaría a un cliente parado en la fila sin poder pagar, y eso es peor
 * que un producto que hay que digitar a mano.
 *
 * Por la misma razón, si la consulta a Supabase falla, se devuelve
 * `verificado: false` con la lista vacía: "no pude verificar" NO es lo mismo
 * que "está todo bien", y la pantalla dice cuál de las dos cosas pasó.
 */

import { supabaseAdmin } from '../db/supabaseClient';
import {
  esCodigoUsable,
  esGs1Pesable,
  esPrefijoGs1Valido,
  gs1TieneCheckValido,
  limpiarCodigo,
  MOTIVO,
  Motivo,
  prefijoGs1,
  variantesParaBuscar,
} from './codigos';

export type ItemVerificable = {
  codigo_barras: string;
  nombre?: string;
  unidad_medida?: string;
};

export type ItemNoVerificado = {
  codigo_barras: string;
  nombre: string;
  motivo: Motivo;
};

export type ResultadoVerificacion = {
  /** ¿La verificación pudo correr? `false` = no sé, no = "está bien". */
  verificado: boolean;
  items_no_verificados: ItemNoVerificado[];
};

/**
 * Qué hay que buscar en la tabla para probar cada ítem.
 *
 * Un GS1 de peso variable NO existe como fila —lleva el peso adentro, cada
 * etiqueta es un código distinto—, así que de esos se busca el PREFIJO de 7
 * dígitos, que sí es una fila. Del resto se busca el código, en todas las
 * variantes internas con que SIESA lo puede tener guardado.
 */
export const codigosABuscar = (items: ItemVerificable[]): string[] => {
  const set = new Set<string>();
  for (const item of items || []) {
    const codigo = limpiarCodigo(item?.codigo_barras);
    if (!esCodigoUsable(codigo)) continue;

    if (esGs1Pesable(codigo)) {
      const prefijo = prefijoGs1(codigo);
      if (esPrefijoGs1Valido(prefijo)) {
        variantesParaBuscar(prefijo).forEach((v) => set.add(v));
      }
      continue;
    }
    variantesParaBuscar(codigo).forEach((v) => set.add(v));
  }
  return [...set];
};

/**
 * Evalúa los ítems contra el conjunto de códigos que SÍ existen en la tabla.
 * Función PURA: toda la decisión vive acá, sin I/O, para poder testearla sola.
 *
 * @param items Ítems del checkout.
 * @param existentes Códigos hallados en `siesa_codigos_barras`, ya limpios.
 */
export const evaluarItems = (
  items: ItemVerificable[],
  existentes: Set<string>,
): ItemNoVerificado[] => {
  const problemas: ItemNoVerificado[] = [];

  for (const item of items || []) {
    const nombre = item?.nombre || 'Producto sin nombre';
    const crudo = item?.codigo_barras;
    const codigo = limpiarCodigo(crudo);

    const reportar = (motivo: Motivo) =>
      problemas.push({ codigo_barras: String(crudo ?? ''), nombre, motivo });

    if (!esCodigoUsable(codigo)) {
      reportar(MOTIVO.SIN_CODIGO);
      continue;
    }

    if (esGs1Pesable(codigo)) {
      // La etiqueta de báscula se valida por estructura + prefijo real: es el
      // único código del QR que legítimamente no existe como fila.
      if (!gs1TieneCheckValido(codigo)) {
        reportar(MOTIVO.GS1_INVALIDO);
        continue;
      }
      const prefijo = prefijoGs1(codigo);
      if (!esPrefijoGs1Valido(prefijo) || !existentes.has(prefijo)) {
        reportar(MOTIVO.GS1_INVALIDO);
      }
      continue;
    }

    if (!existentes.has(codigo)) {
      reportar(MOTIVO.NO_REGISTRADO);
    }
  }

  return problemas;
};

/**
 * Verifica los ítems del checkout contra `siesa_codigos_barras`.
 *
 * Best-effort por diseño: ante CUALQUIER error devuelve `verificado: false` y
 * el checkout continúa. Nunca debe tumbar el registro de la sesión.
 */
export const verificarItemsContraSiesa = async (
  items: ItemVerificable[],
): Promise<ResultadoVerificacion> => {
  const aBuscar = codigosABuscar(items);

  // Sin nada que buscar no hay nada que verificar, pero los ítems sin código
  // igual se reportan: un carrito así es justamente el caso a avisar.
  if (aBuscar.length === 0) {
    return {
      verificado: true,
      items_no_verificados: evaluarItems(items, new Set()),
    };
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('siesa_codigos_barras')
      .select('codigo_barras')
      .in('codigo_barras', aBuscar);

    if (error) throw error;

    // Se guardan LIMPIOS: la tabla tiene `185325+` y `M7702…`, y el ítem llega
    // en su forma física. Comparar crudo daría "no existe" sobre un código real.
    const existentes = new Set<string>();
    (data || []).forEach((row: { codigo_barras: string }) => {
      const limpio = limpiarCodigo(row?.codigo_barras);
      if (limpio) existentes.add(limpio);
    });

    return { verificado: true, items_no_verificados: evaluarItems(items, existentes) };
  } catch (err) {
    console.error('verificarItemsContraSiesa falló (continúo sin verificar):', err);
    return { verificado: false, items_no_verificados: [] };
  }
};
