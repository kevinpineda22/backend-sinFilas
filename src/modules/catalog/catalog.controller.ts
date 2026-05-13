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
    let supabaseQuery = supabaseAdmin
      .from('items_siesa')
      .select('f120_id, f120_descripcion, siesa_codigos_barras!inner(codigo_barras, unidad_medida)')
      .eq('activo', true);

    if (isNumeric) {
      if (parsedGs1Weight !== null) {
        supabaseQuery = supabaseQuery.like('siesa_codigos_barras.codigo_barras', `${searchCode}%`);
      } else {
        // f120_id es INT4 en Postgres: si la query no entra (ej. EAN-13),
        // incluirla en el OR provoca 22P02 "invalid input syntax for type integer"
        // y devuelve 500 al frontend. Solo la incluimos si cabe en INT4.
        const fitsInt4 = cleanQuery.length <= 9 && Number(cleanQuery) <= 2147483647;
        const orClauses = [
          `siesa_codigos_barras.codigo_barras.eq.${cleanQuery}`,
          `siesa_codigos_barras.codigo_barras.eq.${cleanQuery}+`,
        ];
        if (fitsInt4) orClauses.push(`f120_id.eq.${cleanQuery}`);
        supabaseQuery = supabaseQuery.or(orClauses.join(','));
      }
    } else {
      const words = cleanQuery.split(/\s+/).filter((w) => w.length > 0);
      words.forEach((word) => {
        supabaseQuery = supabaseQuery.ilike('f120_descripcion', `%${word}%`);
      });
    }

    const { data, error } = await supabaseQuery.limit(50);

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
