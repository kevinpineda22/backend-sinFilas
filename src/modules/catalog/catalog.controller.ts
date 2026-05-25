import { Request, Response } from 'express';
import { supabaseAdmin } from '../../shared/db/supabaseClient';
import { searchQuerySchema } from './catalog.schemas';
import { isManualSearchPresentation } from './catalog.utils';

export const searchProduct = async (req: Request, res: Response): Promise<void> => {
  const parsed = searchQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    res.status(400).json({
      error: 'validation-error',
      message: 'Código o búsqueda no válidos',
      detail: parsed.error.issues.map((i) => i.message),
    });
    return;
  }

  const cleanQuery = parsed.data.query;
  const isNumeric = /^\d+$/.test(cleanQuery);

  let searchCode = cleanQuery;
  let parsedGs1Weight: number | null = null;

  if (isNumeric && cleanQuery.startsWith('29') && cleanQuery.length === 13) {
    const internalCode = cleanQuery.substring(2, 7);
    const weightStr = cleanQuery.substring(7, 12);
    parsedGs1Weight = parseInt(weightStr, 10) / 1000;
    searchCode = `29${internalCode}`;
  }

  try {
    let result: any;

    if (isNumeric && parsedGs1Weight === null) {
      // ESCANEO / TIPEO DE CÓDIGO NUMÉRICO (no-GS1) — enfoque en 2 pasos.
      //
      // NO se puede filtrar una columna de tabla embebida
      // (`siesa_codigos_barras.codigo_barras`) dentro de un `.or()` a nivel
      // raíz: PostgREST responde "failed to parse logic tree" y la query falla
      // SIEMPRE. Además `f120_id` (raíz) y `codigo_barras` (embebida) son tablas
      // distintas y no pueden convivir en un mismo `.or()`.
      //
      // Paso 1: resolver el/los f120_id buscando el código en
      // `siesa_codigos_barras`, donde todas las columnas del `.or()` viven en la
      // MISMA tabla. La cámara entrega solo el código de barras (sin sufijo de
      // unidad), así que probamos las variantes en que un mismo código aparece:
      // exacto, venta abierta (`+`) y master/multipack (`M`).
      const fitsInt4 = cleanQuery.length <= 9 && Number(cleanQuery) <= 2147483647;
      const orClauses = [
        `codigo_barras.eq.${cleanQuery}`,
        `codigo_barras.eq.${cleanQuery}+`,
        `codigo_barras.eq.M${cleanQuery}`,
      ];
      // f120_id es INT4: solo lo incluimos si cabe, para no provocar 22P02.
      if (fitsInt4) orClauses.push(`f120_id.eq.${cleanQuery}`);

      const { data: hits, error: hitErr } = await supabaseAdmin
        .from('siesa_codigos_barras')
        .select('f120_id')
        .or(orClauses.join(','))
        .limit(200);

      if (hitErr) {
        console.error('Error en Supabase (lookup código de barras):', hitErr);
        res.status(500).json({
          error: 'catalog-query-failed',
          message: 'No se pudo consultar el catálogo',
          detail: hitErr.message,
        });
        return;
      }

      const ids = [...new Set((hits ?? []).map((h: any) => h.f120_id))];
      if (ids.length === 0) {
        // El código realmente no existe en el catálogo.
        res.json([]);
        return;
      }

      // Paso 2: traer los productos activos con TODAS sus presentaciones (sin
      // `!inner`), para que el frontend pueda hacer el match exacto contra la
      // unidad de medida que corresponda.
      result = await supabaseAdmin
        .from('items_siesa')
        .select('f120_id, f120_descripcion, siesa_codigos_barras(codigo_barras, unidad_medida)')
        .eq('activo', true)
        .in('f120_id', ids)
        .limit(50);
    } else {
      // GS1 pesable (`like`) o búsqueda por TEXTO (`ilike`): ambos filtran
      // columnas que SÍ se pueden expresar directo sobre el recurso o su
      // tabla embebida, así que la query de un solo paso funciona bien.
      let supabaseQuery = supabaseAdmin
        .from('items_siesa')
        .select('f120_id, f120_descripcion, siesa_codigos_barras!inner(codigo_barras, unidad_medida)')
        .eq('activo', true);

      if (parsedGs1Weight !== null) {
        supabaseQuery = supabaseQuery.like('siesa_codigos_barras.codigo_barras', `${searchCode}%`);
      } else {
        const words = cleanQuery.split(/\s+/).filter((w) => w.length > 0);
        words.forEach((word) => {
          supabaseQuery = supabaseQuery.ilike('f120_descripcion', `%${word}%`);
        });
      }

      result = await supabaseQuery.limit(50);
    }

    const { data, error } = result;

    if (error) {
      // Errores de casteo (ej. número que no cabe en INT) NO son fallas reales:
      // semánticamente significan "no existe ese producto". Devolvemos array
      // vacío con 200 para que el frontend muestre "Producto no encontrado"
      // en lugar de "Error de conexión".
      const castCodes = ['22P02', '22003', '22023'];
      const isCastError =
        (error.code && castCodes.includes(error.code)) ||
        /invalid input syntax|out of range/i.test(error.message || '');

      if (isCastError) {
        res.json([]);
        return;
      }

      console.error('Error en Supabase:', error);
      res.status(500).json({
        error: 'catalog-query-failed',
        message: 'No se pudo consultar el catálogo',
        detail: error.message,
      });
      return;
    }

    const grouped: Record<string, any> = {};
    (data ?? []).forEach((item: any) => {
      if (!grouped[item.f120_id]) {
        grouped[item.f120_id] = {
          f120_id: item.f120_id,
          nombre: item.f120_descripcion,
          presentaciones: [],
        };
      }

      const barras = Array.isArray(item.siesa_codigos_barras)
        ? item.siesa_codigos_barras
        : [item.siesa_codigos_barras];

      barras.forEach((b: any) => {
        if (!b) return;
        const um = b.unidad_medida || 'UND';
        const exists = grouped[item.f120_id].presentaciones.find(
          (p: any) => p.unidad_medida === um && p.codigo_barras === b.codigo_barras,
        );

        if (!exists) {
          const isWeighable =
            ['KL', 'LB', '500GR', '250GR', 'PZ'].includes(um) || b.codigo_barras.startsWith('29');
          grouped[item.f120_id].presentaciones.push({
            codigo_barras: b.codigo_barras,
            unidad_medida: um,
            requiere_peso: isWeighable,
          });
        }
      });
    });

    const results = Object.values(grouped)
      .map((prod: any) => {
        if (parsedGs1Weight !== null) {
          prod.scanned_quantity = parsedGs1Weight;
          prod.isGs1 = true;
          return prod;
        }

        // Búsqueda por texto: solo mostramos presentaciones útiles para
        // selección manual (códigos con sufijo de unidad o GS1 pesables).
        // En búsqueda numérica (escaneo / tipeo de código) dejamos todo
        // para que el frontend pueda hacer match exacto.
        if (!isNumeric) {
          prod.presentaciones = prod.presentaciones.filter((p: any) =>
            isManualSearchPresentation(p.codigo_barras, p.unidad_medida),
          );
        }
        return prod;
      })
      // Si después del filtro un producto quedó sin presentaciones, no tiene
      // sentido mostrarlo en el buscador.
      .filter((prod: any) => isNumeric || prod.presentaciones.length > 0);

    res.json(results);
  } catch (error: any) {
    console.error('Error in searchProduct:', error);
    res.status(500).json({
      error: 'internal-server-error',
      message: 'Error inesperado al buscar el producto',
      detail: error.message,
    });
  }
};
