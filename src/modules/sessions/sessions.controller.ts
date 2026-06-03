import { Request, Response } from 'express';
import { supabaseAdmin } from '../../shared/db/supabaseClient';
import { logAudit } from '../../shared/audit/auditWriter';
import { checkoutDirectBodySchema } from './sessions.schemas';

const rollbackSession = async (sessionId: string): Promise<void> => {
  try {
    await supabaseAdmin.from('sf_sessions').delete().eq('id', sessionId);
  } catch (err) {
    console.error('Rollback de sf_sessions falló para', sessionId, err);
  }
};

type PasilloInfo = { pasillo: string; pasillo_orden: number };

/**
 * Resuelve el pasillo de cada producto del carrito para la sede activa,
 * leyendo la cache `sf_producto_pasillos` (poblada por el sync desde Woo).
 * Devuelve un Map f120_id → { pasillo, pasillo_orden }.
 *
 * Best-effort: ante CUALQUIER error devuelve lo que tenga y el checkout sigue.
 * Nunca debe tumbar el registro de la sesión.
 */
const resolvePasillos = async (
  sedeId: string,
  items: Array<{ f120_id?: number }>
): Promise<Map<number, PasilloInfo>> => {
  const map = new Map<number, PasilloInfo>();
  try {
    const f120Ids = [
      ...new Set(
        items
          .map((i) => i.f120_id)
          .filter((id): id is number => typeof id === 'number')
      ),
    ];
    if (f120Ids.length === 0) return map;

    const { data: sede } = await supabaseAdmin
      .from('wc_sedes')
      .select('slug')
      .eq('id', sedeId)
      .single();

    const sedeSlug = (sede as { slug?: string } | null)?.slug;
    if (!sedeSlug) return map;

    const { data: rows, error } = await supabaseAdmin
      .from('sf_producto_pasillos')
      .select('f120_id, pasillo, pasillo_orden')
      .eq('sede_slug', sedeSlug)
      .in('f120_id', f120Ids);

    if (error) throw error;

    (rows || []).forEach((r: any) => {
      map.set(Number(r.f120_id), {
        pasillo: r.pasillo,
        pasillo_orden: r.pasillo_orden,
      });
    });
  } catch (err) {
    console.error('resolvePasillos falló (continúo sin pasillos):', err);
  }
  return map;
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
        estado: 'completada',
        total_items: items.length,
      })
      .select()
      .single();

    if (sessionError) throw sessionError;
    createdSessionId = session.id;

    // 1b. Resolver pasillos por sede desde la cache (sf_producto_pasillos).
    // No es crítico: si algo falla o falta, el ítem queda sin pasillo y el
    // checkout continúa igual.
    const pasilloMap = await resolvePasillos(sedeId, items);

    // 2. Items — con posicion (orden de escaneo) y pasillo resuelto.
    const itemsToInsert = items.map((item, index) => {
      const info =
        item.f120_id != null ? pasilloMap.get(item.f120_id) : undefined;
      return {
        session_id: session.id,
        codigo_barras: item.codigo_barras,
        nombre_producto: item.nombre,
        cantidad: item.cantidad,
        unidad_medida: item.unidad_medida,
        // Guardamos f120_id para poder reconstruir la imagen (desde Woo) al
        // reabrir la sesión desde el historial. Opcional: si falta, queda null.
        f120_id: item.f120_id ?? null,
        posicion: index,
        pasillo: info?.pasillo ?? null,
        pasillo_orden: info?.pasillo_orden ?? null,
      };
    });

    const { error: itemsError } = await supabaseAdmin
      .from('sf_session_items')
      .insert(itemsToInsert);

    if (itemsError) throw itemsError;

    await logAudit({
      action: 'session.finalized',
      sessionId: session.id,
      userId: vipUserId,
      details: { sede_id: sedeId, total_items: items.length },
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
 * Obtiene el historial de sesiones del usuario VIP actual.
 * - Requiere JWT (req.user.id).
 * - Opcionalmente filtra por sede si se provee X-Sede-ID.
 * - Incluye los items de cada sesión. El QR se reconstruye localmente
 *   en el frontend a partir de los items (no se persiste token).
 */
export const getUserSessions = async (req: Request, res: Response): Promise<void> => {
  if (!req.user?.id) {
    res.status(401).json({ error: 'unauthorized', detail: 'req.user no inyectado' });
    return;
  }

  const vipUserId = req.user.id;
  const sedeId = req.sedeId; // puede ser undefined si no lo obligamos con requireSede

  try {
    let query = supabaseAdmin
      .from('sf_sessions')
      .select(`
        id,
        estado,
        total_items,
        created_at,
        sf_session_items (
          codigo_barras,
          nombre_producto,
          cantidad,
          unidad_medida,
          f120_id
        )
      `)
      .eq('vip_user_id', vipUserId)
      .order('created_at', { ascending: false });

    if (sedeId) {
      query = query.eq('sede_id', sedeId);
    }

    const { data: sessions, error } = await query;

    if (error) throw error;

    const formattedSessions = sessions.map((session: any) => ({
      id: session.id,
      estado: session.estado,
      total_items: session.total_items,
      created_at: session.created_at,
      items: session.sf_session_items.map((item: any) => ({
        codigo_barras: item.codigo_barras,
        nombre: item.nombre_producto,
        cantidad: item.cantidad,
        unidad_medida: item.unidad_medida,
        f120_id: item.f120_id ?? null,
      })),
    }));

    res.status(200).json({
      success: true,
      data: formattedSessions,
    });
  } catch (error: any) {
    console.error('Error en getUserSessions:', error);
    res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
};
