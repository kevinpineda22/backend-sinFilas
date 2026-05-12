import { Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../shared/db/supabaseClient';

const ESTADOS = ['en_proceso', 'completada'] as const;

const sessionsQuerySchema = z.object({
  estado: z.enum(ESTADOS).optional(),
  vip_user_id: z.string().uuid().optional(),
  search: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const detailParamsSchema = z.object({
  id: z.string().uuid(),
});

const analyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(180).default(30),
});

type SessionRow = {
  id: string;
  estado: string;
  total_items: number;
  created_at: string;
  vip_user_id: string;
  sede_id: string | null;
  profiles: { nombre: string | null; correo: string | null } | null;
};

const applySedeFilter = <T extends { eq: (col: string, val: string) => T }>(
  query: T,
  sedeId: string | undefined
): T => (sedeId ? query.eq('sede_id', sedeId) : query);

export const getDashboardStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const sedeId = req.sedeId;

    const sessionsBase = supabaseAdmin
      .from('sf_sessions')
      .select('estado, total_items, vip_user_id, created_at');

    const { data: rows, error } = await applySedeFilter(sessionsBase, sedeId);
    if (error) throw error;

    const sessions = (rows || []) as Array<{
      estado: string;
      total_items: number;
      vip_user_id: string;
      created_at: string;
    }>;

    const totalSessions = sessions.length;
    const totalItems = sessions.reduce((acc, s) => acc + Number(s.total_items || 0), 0);
    const activeVips = new Set(sessions.map((s) => s.vip_user_id)).size;
    const cancelled = 0;
    const registered = sessions.length;

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const sessionsToday = sessions.filter(
      (s) => new Date(s.created_at).getTime() >= startOfDay.getTime()
    ).length;

    res.json({
      totalSessions,
      totalItems,
      activeVips,
      cancelled,
      registered,
      sessionsToday,
    });
  } catch (error: any) {
    console.error('Error en getDashboardStats:', error);
    res.status(500).json({ error: error.message || 'Error obteniendo analíticas' });
  }
};

export const getSessionsHistory = async (req: Request, res: Response): Promise<void> => {
  const parsed = sessionsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: 'validation-error',
      detail: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }

  const { estado, vip_user_id, search, limit, offset } = parsed.data;
  const sedeId = req.sedeId;

  try {
    let query = supabaseAdmin
      .from('sf_sessions')
      .select(
        `
        id,
        estado,
        total_items,
        created_at,
        vip_user_id,
        sede_id,
        profiles ( nombre, correo )
      `,
        { count: 'exact' }
      )
      .order('created_at', { ascending: false });

    query = applySedeFilter(query, sedeId);
    if (estado) query = query.eq('estado', estado);
    if (vip_user_id) query = query.eq('vip_user_id', vip_user_id);

    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    let rows = (data || []) as unknown as SessionRow[];

    if (search) {
      const needle = search.toLowerCase();
      rows = rows.filter((s) => {
        const nombre = s.profiles?.nombre?.toLowerCase() || '';
        const correo = s.profiles?.correo?.toLowerCase() || '';
        return nombre.includes(needle) || correo.includes(needle) || s.id.includes(needle);
      });
    }

    res.json({ data: rows, total: count ?? rows.length });
  } catch (error: any) {
    console.error('Error en getSessionsHistory:', error);
    res.status(500).json({ error: error.message || 'Error obteniendo historial' });
  }
};

export const getCancelledSessions = async (req: Request, res: Response): Promise<void> => {
  try {
    res.json({ data: [], total: 0 });
  } catch (error: any) {
    console.error('Error en getCancelledSessions:', error);
    res.status(500).json({ error: error.message || 'Error obteniendo canceladas' });
  }
};

export const getSessionDetail = async (req: Request, res: Response): Promise<void> => {
  const parsed = detailParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation-error', detail: 'id debe ser UUID' });
    return;
  }

  const { id } = parsed.data;

  try {
    const { data: session, error: sessErr } = await supabaseAdmin
      .from('sf_sessions')
      .select(
        `
        id,
        estado,
        total_items,
        created_at,
        vip_user_id,
        sede_id,
        profiles ( nombre, correo )
      `
      )
      .eq('id', id)
      .single();

    if (sessErr || !session) {
      res.status(404).json({ error: 'session-not-found', detail: 'La sesión no existe' });
      return;
    }

    const { data: items, error: itemsErr } = await supabaseAdmin
      .from('sf_session_items')
      .select('codigo_barras, nombre_producto, cantidad, unidad_medida')
      .eq('session_id', id);

    if (itemsErr) throw itemsErr;

    res.json({ session, items: items || [] });
  } catch (error: any) {
    console.error('Error en getSessionDetail:', error);
    res.status(500).json({ error: error.message || 'Error obteniendo detalle' });
  }
};

export const getAnalytics = async (req: Request, res: Response): Promise<void> => {
  const parsed = analyticsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation-error', detail: 'days inválido' });
    return;
  }

  const { days } = parsed.data;
  const sedeId = req.sedeId;
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);
  const sinceIso = since.toISOString();

  try {
    let query = supabaseAdmin
      .from('sf_sessions')
      .select(
        `
        id,
        estado,
        total_items,
        created_at,
        vip_user_id,
        profiles ( nombre, correo )
      `
      )
      .gte('created_at', sinceIso);

    query = applySedeFilter(query, sedeId);

    const { data, error } = await query;
    if (error) throw error;

    type AnalyticsRow = {
      id: string;
      estado: string;
      total_items: number;
      created_at: string;
      vip_user_id: string;
      profiles: { nombre: string | null; correo: string | null } | null;
    };

    const rows = (data || []) as unknown as AnalyticsRow[];

    const dailyMap = new Map<string, { date: string; sessions: number; items: number }>();
    for (let i = 0; i < days; i++) {
      const d = new Date(since);
      d.setDate(since.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      dailyMap.set(key, { date: key, sessions: 0, items: 0 });
    }
    rows.forEach((r) => {
      const key = r.created_at.slice(0, 10);
      const bucket = dailyMap.get(key);
      if (bucket) {
        bucket.sessions += 1;
        bucket.items += Number(r.total_items || 0);
      }
    });
    const daily = Array.from(dailyMap.values());

    const stateMap = new Map<string, number>();
    rows.forEach((r) => stateMap.set(r.estado, (stateMap.get(r.estado) || 0) + 1));
    const states = Array.from(stateMap.entries()).map(([estado, count]) => ({ estado, count }));

    const vipMap = new Map<
      string,
      { vip_user_id: string; nombre: string; correo: string; sessions: number; items: number }
    >();
    rows.forEach((r) => {
      const cur = vipMap.get(r.vip_user_id) || {
        vip_user_id: r.vip_user_id,
        nombre: r.profiles?.nombre || 'Sin nombre',
        correo: r.profiles?.correo || '',
        sessions: 0,
        items: 0,
      };
      cur.sessions += 1;
      cur.items += Number(r.total_items || 0);
      vipMap.set(r.vip_user_id, cur);
    });
    const topVips = Array.from(vipMap.values())
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 10);

    const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, sessions: 0 }));
    rows.forEach((r) => {
      const h = new Date(r.created_at).getHours();
      hourly[h].sessions += 1;
    });

    res.json({
      since: sinceIso,
      days,
      daily,
      states,
      topVips,
      hourly,
      totals: {
        sessions: rows.length,
        items: rows.reduce((acc, r) => acc + Number(r.total_items || 0), 0),
        vips: vipMap.size,
      },
    });
  } catch (error: any) {
    console.error('Error en getAnalytics:', error);
    res.status(500).json({ error: error.message || 'Error obteniendo analítica' });
  }
};

export const getVipsList = async (req: Request, res: Response): Promise<void> => {
  const sedeId = req.sedeId;
  try {
    let query = supabaseAdmin
      .from('sf_sessions')
      .select(`
        vip_user_id,
        total_items,
        profiles ( nombre, correo )
      `);

    query = applySedeFilter(query, sedeId);

    const { data, error } = await query;
    if (error) throw error;

    const vipMap = new Map<
      string,
      { vip_user_id: string; nombre: string; correo: string; sessions: number; items: number }
    >();

    (data || []).forEach((r: any) => {
      const cur = vipMap.get(r.vip_user_id) || {
        vip_user_id: r.vip_user_id,
        nombre: r.profiles?.nombre || 'Sin nombre',
        correo: r.profiles?.correo || '',
        sessions: 0,
        items: 0,
      };
      cur.sessions += 1;
      cur.items += Number(r.total_items || 0);
      vipMap.set(r.vip_user_id, cur);
    });

    const vips = Array.from(vipMap.values()).sort((a, b) => b.sessions - a.sessions);

    res.json({ data: vips, total: vips.length });
  } catch (error: any) {
    console.error('Error en getVipsList:', error);
    res.status(500).json({ error: error.message || 'Error obteniendo VIPs' });
  }
};
