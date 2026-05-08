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

    // Detectar código GS1 de báscula (Carnicería/Fruver: prefijo 29, 13 dígitos)
    if (isNumeric && cleanQuery.startsWith('29') && cleanQuery.length === 13) {
      // Formato GS1: 29 (2) + internalCode (5) + weight (5) + checkDigit (1)
      const internalCode = cleanQuery.substring(2, 7);
      const weightStr = cleanQuery.substring(7, 12);
      parsedGs1Weight = parseInt(weightStr, 10) / 1000; // Generalmente en KG

      searchCode = `29${internalCode}`; 
    }

    let supabaseQuery = supabaseAdmin
      .from('siesa_codigos_barras')
      .select('f120_id, codigo_barras, descripcion, unidad_medida, requiere_peso');

    if (isNumeric) {
      if (parsedGs1Weight !== null) {
        // Es un código de báscula, buscamos el prefijo
        supabaseQuery = supabaseQuery.like('codigo_barras', `${searchCode}%`);
      } else {
        // Búsqueda exacta por EAN (con o sin +) o por f120_id (item corto)
        supabaseQuery = supabaseQuery.or(`codigo_barras.eq.${cleanQuery},codigo_barras.eq.${cleanQuery}+,f120_id.eq.${cleanQuery}`);
      }
    } else {
      // Búsqueda por nombre de producto
      supabaseQuery = supabaseQuery.ilike('descripcion', `%${cleanQuery}%`);
    }

    const { data, error } = await supabaseQuery.limit(50); // Traemos más para poder agrupar bien

    if (error) {
      console.error('Error en Supabase:', error);
      res.status(500).json({ error: 'Error consultando catálogo' });
      return;
    }

    // Agrupar resultados por f120_id
    const grouped = data.reduce((acc: any, item: any) => {
      if (!acc[item.f120_id]) {
        acc[item.f120_id] = {
          f120_id: item.f120_id,
          nombre: item.descripcion,
          presentaciones: []
        };
      }
      
      // Evitar duplicar la misma unidad de medida para el mismo f120_id
      const um = item.unidad_medida || 'UND';
      const exists = acc[item.f120_id].presentaciones.find((p: any) => p.unidad_medida === um);
      
      if (!exists) {
        // Lógica para detectar si requiere peso (por flag, por UM pesable, o prefijo GS1)
        const isWeighable = item.requiere_peso === true || 
                            ['KL', 'LB', '500GR', '250GR', 'PZ'].includes(um) || 
                            item.codigo_barras.startsWith('29');

        acc[item.f120_id].presentaciones.push({
          codigo_barras: item.codigo_barras,
          unidad_medida: um,
          requiere_peso: isWeighable
        });
      }
      
      return acc;
    }, {});

    const results = Object.values(grouped).map((prod: any) => {
      // Si fue escaneado con báscula exacta, inyectamos la data para que el Front sepa
      if (parsedGs1Weight !== null) {
        prod.scanned_quantity = parsedGs1Weight;
        prod.isGs1 = true;
      }
      return prod;
    });

    res.json(results);
  } catch (error) {
    console.error('Error in searchProduct:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
