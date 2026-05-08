import { Request, Response } from 'express';
import { supabaseAdmin } from '../../shared/db/supabaseClient';
import crypto from 'crypto';

const QR_SIGNING_SECRET = process.env.QR_SIGNING_SECRET || 'super-secret-key-123';

export const createDirectCheckout = async (req: Request, res: Response): Promise<void> => {
  try {
    const { items, vip_user_id, sede_id, raw_qr_string } = req.body;

    if (!items || items.length === 0) {
      res.status(400).json({ error: 'El carrito no puede estar vacío' });
      return;
    }

    // 1. Crear sesión
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('sf_sessions')
      .insert({
        vip_user_id: vip_user_id || '00000000-0000-0000-0000-000000000000', 
        sede_id: sede_id || '00000000-0000-0000-0000-000000000000', 
        estado: 'finalizado',
        total_items: items.length
      })
      .select()
      .single();

    if (sessionError) throw sessionError;

    // 2. Crear items
    const itemsToInsert = items.map((item: any) => ({
      session_id: session.id,
      codigo_barras: item.codigo_barras,
      nombre_producto: item.nombre,
      cantidad: item.cantidad,
      unidad_medida: item.unidad_medida
    }));

    const { error: itemsError } = await supabaseAdmin
      .from('sf_session_items')
      .insert(itemsToInsert);

    if (itemsError) throw itemsError;

    // 3. Insertar Token
    // Como la caja lee directamente un listado de códigos de barras (raw_qr_string), 
    // no podemos forzar a la caja a leer un JWT.
    // Usaremos un uuid seguro para guardar en la BD como registro del QR generado
    // y devolveremos al Frontend que puede mostrar tranquilamente su string de códigos.
    const secureTokenId = crypto.randomUUID();
    const expiresAtIso = '2099-12-31T23:59:59Z'; // Sin expiración

    const { error: tokenError } = await supabaseAdmin
      .from('sf_qr_tokens')
      .insert({
        session_id: session.id,
        token: secureTokenId, 
        expires_at: expiresAtIso
      });

    if (tokenError) throw tokenError;

    // 5. Responder
    res.status(201).json({
      session_id: session.id,
      success: true
      // Ya no enviamos un QR Token porque el frontend pinta el raw_qr_string que armó
    });

  } catch (error: any) {
    console.error('Error en createDirectCheckout:', error);
    res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
};
