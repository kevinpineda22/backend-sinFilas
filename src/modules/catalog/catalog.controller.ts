import { Request, Response } from 'express';
import { supabaseAdmin } from '../../shared/db/supabaseClient';

export const searchProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const { query } = req.query;
    
    if (!query || typeof query !== 'string') {
      res.status(400).json({ error: 'El parámetro "query" es requerido' });
      return;
    }

    const cleanQuery = query.trim();
    const isNumeric = /^\d+$/.test(cleanQuery);

    let searchCode = cleanQuery;
    let parsedGs1Weight: number | null = null;

    if (isNumeric && cleanQuery.startsWith('29') && cleanQuery.length 
=== 13) {
      const internalCode = cleanQuery.substring(2, 7);
      const weightStr = cleanQuery.substring(7, 12);
      parsedGs1Weight = parseInt(weightStr, 10) / 1000;
      searchCode = `29${internalCode}`;
    }

    let supabaseQuery = supabaseAdmin
      .from('items_siesa')
      .select('f120_id, f120_descripcion, siesa_codigos_barras!inner(codigo_barras, unidad_medida)');

    if (isNumeric) {
      if (parsedGs1Weight !== null) {
        supabaseQuery = supabaseQuery.like('siesa_codigos_barras.codigo_barras', `${searchCode}%`);
      } else {
        supabaseQuery = supabaseQuery.or(`siesa_codigos_barras.codigo_barras.eq.${cleanQuery},siesa_codigos_barras.codigo_barras.eq.${cleanQuery}+,f120_id.eq.${cleanQuery}`);
      }
    } else {
      supabaseQuery = supabaseQuery.ilike('f120_descripcion', `%${cleanQuery}%`);
    }

    const { data, error } = await supabaseQuery.limit(50);

    if (error) {
      console.error('Error en Supabase:', error);
      res.status(500).json({ error: 'Error consultando catálogo', detail: error.message });
      return;
    }

    const grouped: any = {};
    data.forEach((item: any) => {
      if (!grouped[item.f120_id]) {
        grouped[item.f120_id] = {
          f120_id: item.f120_id,
          nombre: item.f120_descripcion,
          presentaciones: []
        };
      }

      const barras = Array.isArray(item.siesa_codigos_barras) ? item.siesa_codigos_barras : [item.siesa_codigos_barras];
      barras.forEach((b: any) => {
        if (!b) return;
        const um = b.unidad_medida || 'UND';
        const exists = grouped[item.f120_id].presentaciones.find((p: any) => p.unidad_medida === um && p.codigo_barras === b.codigo_barras);

        if (!exists) {
          const isWeighable = ['KL', 'LB', '500GR', '250GR', 'PZ'].includes(um) || b.codigo_barras.startsWith('29');
          grouped[item.f120_id].presentaciones.push({
            codigo_barras: b.codigo_barras,
            unidad_medida: um,
            requiere_peso: isWeighable
          });
        }
      });
    });

    const results = Object.values(grouped).map((prod: any) => {
      if (parsedGs1Weight !== null) {
        prod.scanned_quantity = parsedGs1Weight;
        prod.isGs1 = true;
      }
      return prod;
    });

    res.json(results);
  } catch (error: any) {
    console.error('Error in searchProduct:', error);
    res.status(500).json({ error: 'Internal server error', detail: error.message });
  }
};
