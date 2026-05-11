import { Request, Response } from 'express';
import crypto from 'crypto';
import { supabaseAdmin } from '../../shared/db/supabaseClient';
import { logAudit } from '../../shared/audit/auditWriter';
import { checkoutDirectBodySchema, redeemParamsSchema } from './sessions.schemas';

const EXPIRES_NEVER = '2099-12-31T23:59:59Z';

const rollbackSession = async (sessionId: string): Promise<void> => {
  try {
    await supabaseAdmin.from('sf_sessions').delete().eq('id', sessionId);
  } catch (err) {
    console.error('Rollback de sf_sessions falló para', sessionId, err);
  }
};

export const createDirectCheckout = async (req: Request, res: Response): Promise<void> => {
  const parsed = checkoutDirectBodySchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: 'validation-error',
      detail: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }

  if (!req.user?.id) {
    res.status(401).json({ error: 'unauthorized', detail: 'req.user no inyectado' });
    return;
  }
  if (!req.sedeId) {
    res.status(400).json({ error: 'missing-sede-id', detail: 'req.sedeId no inyectado' });
    return;
  }

  const { items } = parsed.data;
  const vipUserId = req.user.id;
  const sedeId = req.sedeId;

  let createdSessionId: string | null = null;

  try {
    // 1. Sesión
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('sf_sessions')
      .insert({
        vip_user_id: vipUserId,
        sede_id: sedeId,
        estado: 'finalizado',
        total_items: items.length,
      })
      .select()
      .single();

    if (sessionError) throw sessionError;
    createdSessionId = session.id;

    // 2. Items
    const itemsToInsert = items.map((item) => ({
      session_id: session.id,
      codigo_barras: item.codigo_barras,
      nombre_producto: item.nombre,
      cantidad: item.cantidad,
      unidad_medida: item.unidad_medida,
    }));

    const { error: itemsError } = await supabaseAdmin
      .from('sf_session_items')
      .insert(itemsToInsert);

    if (itemsError) throw itemsError;

    // 3. Token QR
    const secureTokenId = crypto.randomUUID();

    const { error: tokenError } = await supabaseAdmin.from('sf_qr_tokens').insert({
      session_id: session.id,
      token: secureTokenId,
      expires_at: EXPIRES_NEVER,
    });

    if (tokenError) throw tokenError;

    // Audit (fire-and-forget en la respuesta, pero await-eamos para tests deterministas)
    await logAudit({
      action: 'session.finalized',
      sessionId: session.id,
      userId: vipUserId,
      details: { sede_id: sedeId, total_items: items.length },
    });
    await logAudit({
      action: 'qr.generated',
      sessionId: session.id,
      userId: vipUserId,
      details: { token: secureTokenId },
    });

    res.status(201).json({
      session_id: session.id,
      success: true,
    });
  } catch (error: any) {
    console.error('Error en createDirectCheckout:', error);

    if (createdSessionId) {
      await rollbackSession(createdSessionId);
      await logAudit({
        action: 'session.rollback',
        sessionId: createdSessionId,
        userId: vipUserId,
        details: { reason: error?.message ?? 'unknown' },
      });
    }

    res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
};

/**
 * Marca una sesión como cobrada por el POS.
 * - Valida que `:id` sea UUID.
 * - Devuelve 404 si la sesión no existe.
 * - Devuelve 409 si la sesión NO está en estado 'finalizado' (ya cobrada o cancelada).
 * - Actualiza `sf_qr_tokens.used_at` y `sf_sessions.estado='cobrado'`.
 * - Escribe `qr.redeemed` en `sf_audit_log`.
 */
export const redeemSession = async (req: Request, res: Response): Promise<void> => {
  const parsed = redeemParamsSchema.safeParse(req.params);

  if (!parsed.success) {
    res.status(400).json({
      error: 'validation-error',
      detail: parsed.error.issues.map((i) => i.message),
    });
    return;
  }

  const sessionId = parsed.data.id;

  try {
    const { data: session, error: fetchError } = await supabaseAdmin
      .from('sf_sessions')
      .select('id, estado')
      .eq('id', sessionId)
      .single();

    if (fetchError || !session) {
      res.status(404).json({ error: 'session-not-found', detail: 'La sesión no existe' });
      return;
    }

    if (session.estado === 'cobrado') {
      res.status(409).json({ error: 'session-already-redeemed', detail: 'La sesión ya fue cobrada' });
      return;
    }

    if (session.estado === 'cancelado') {
      res.status(409).json({ error: 'session-cancelled', detail: 'La sesión fue cancelada' });
      return;
    }

    const nowIso = new Date().toISOString();

    const { error: tokenError } = await supabaseAdmin
      .from('sf_qr_tokens')
      .update({ used_at: nowIso })
      .eq('session_id', sessionId);

    if (tokenError) throw tokenError;

    const { error: stateError } = await supabaseAdmin
      .from('sf_sessions')
      .update({ estado: 'cobrado', updated_at: nowIso })
      .eq('id', sessionId);

    if (stateError) throw stateError;

    await logAudit({
      action: 'qr.redeemed',
      sessionId,
      userId: null,
      details: { redeemed_at: nowIso },
    });

    res.status(200).json({
      success: true,
      session_id: sessionId,
      redeemed_at: nowIso,
    });
  } catch (error: any) {
    console.error('Error en redeemSession:', error);
    res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
};
