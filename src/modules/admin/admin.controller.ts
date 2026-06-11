import { Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../shared/db/supabaseClient';
import { logAudit } from '../../shared/audit/auditWriter';

const ESTADOS = ['en_proceso', 'completada'] as const;

const sessionsQuerySchema = z.object({
  estado: z.enum(ESTADOS).optional(),
  vip_user_id: z.string().uuid().optional(),
  search: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(25),
  // Cursor keyset: `created_at` de la última fila ya vista. Pedimos las
  // anteriores a ese instante. A diferencia de offset, NO escanea-y-descarta:
  // va directo al índice de created_at, así que la página 1 cuesta lo mismo que
  // la 1000. Opaco para el cliente: lo recibe en `nextCursor` y lo devuelve tal cual.
  before: z.string().min(1).optional(),
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
  total_precio: number | null;
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

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startIso = startOfDay.toISOString();

    // Conteos del lado de la DB con `head: true`: NO transfiere filas, solo
    // devuelve el número. Antes se traían TODAS las sesiones a memoria solo para
    // hacer `.length`/`.reduce` — inviable a escala. (Inlineamos el filtro de
    // sede en vez de usar `applySedeFilter` para no disparar la recursión de
    // tipos del builder de `count`.)
    let totalQuery = supabaseAdmin
      .from('sf_sessions')
      .select('*', { count: 'exact', head: true });
    if (sedeId) totalQuery = totalQuery.eq('sede_id', sedeId);

    let todayQuery = supabaseAdmin
      .from('sf_sessions')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', startIso);
    if (sedeId) todayQuery = todayQuery.eq('sede_id', sedeId);

    // Suma de items y VIPs únicos: supabase-js no agrega sin un RPC, así que
    // traemos SOLO esas dos columnas (liviano) y agregamos en memoria. Si esto
    // escala a cientos de miles de filas, el próximo paso es una función RPC en
    // Postgres que devuelva todo agregado en una sola fila.
    let aggQuery = supabaseAdmin
      .from('sf_sessions')
      .select('total_items, vip_user_id');
    if (sedeId) aggQuery = aggQuery.eq('sede_id', sedeId);

    const [totalRes, todayRes, aggRes] = await Promise.all([totalQuery, todayQuery, aggQuery]);
    if (totalRes.error) throw totalRes.error;
    if (todayRes.error) throw todayRes.error;
    if (aggRes.error) throw aggRes.error;

    const aggRows = (aggRes.data || []) as Array<{ total_items: number; vip_user_id: string }>;
    const totalSessions = totalRes.count ?? aggRows.length;
    const sessionsToday = todayRes.count ?? 0;
    const totalItems = aggRows.reduce((acc, s) => acc + Number(s.total_items || 0), 0);
    const activeVips = new Set(aggRows.map((s) => s.vip_user_id)).size;

    res.json({
      totalSessions,
      totalItems,
      activeVips,
      cancelled: 0,
      registered: totalSessions,
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

  const { estado, vip_user_id, search, limit, before } = parsed.data;
  const sedeId = req.sedeId;
  const isFirstPage = !before;

  try {
    // Búsqueda por nombre/correo: el filtro DEBE resolverse en la DB ANTES de
    // paginar. Antes se filtraba en memoria sobre la página ya cortada (.range),
    // así que solo encontraba coincidencias dentro de esas `limit` filas: si el
    // VIP buscado caía en otra página, no aparecía nunca.
    //
    // Como nombre/correo viven en la tabla embebida `profiles`, resolvemos
    // primero los vip_user_id cuyo perfil matchea y filtramos `sf_sessions` por
    // esos ids. Si el término es un UUID, además lo probamos como id de sesión.
    let searchUserIds: string[] | null = null;
    let searchIsUuid = false;
    if (search) {
      searchIsUuid = UUID_RE.test(search);
      const { data: matchedProfiles, error: profErr } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .or(`nombre.ilike.%${search}%,correo.ilike.%${search}%`);
      if (profErr) throw profErr;
      searchUserIds = (matchedProfiles || []).map((p: any) => p.id as string);

      // Si no matchea ningún perfil y tampoco es un id de sesión, no hay nada
      // que traer: evitamos una query inútil.
      if (searchUserIds.length === 0 && !searchIsUuid) {
        res.json({ data: [], total: 0 });
        return;
      }
    }

    // El `count: 'exact'` (que escanea todo para contar) solo se pide en la
    // PRIMERA página, para el "Mostrando X de Y". En cada "Cargar más" se omite:
    // así el load-more queda 100% keyset, sin recontar nada.
    let query = supabaseAdmin
      .from('sf_sessions')
      .select(
        `
        id,
        estado,
        total_items,
        total_precio,
        created_at,
        vip_user_id,
        sede_id,
        profiles ( nombre, correo )
      `,
        isFirstPage ? { count: 'exact' } : undefined
      )
      .order('created_at', { ascending: false })
      .limit(limit);

    if (sedeId) query = query.eq('sede_id', sedeId);
    if (estado) query = query.eq('estado', estado);
    if (vip_user_id) query = query.eq('vip_user_id', vip_user_id);

    if (searchUserIds) {
      const orParts: string[] = [];
      if (searchUserIds.length > 0) orParts.push(`vip_user_id.in.(${searchUserIds.join(',')})`);
      if (searchIsUuid) orParts.push(`id.eq.${search}`);
      // `.or(...)` se combina con AND respecto a los demás filtros (sede/estado).
      query = query.or(orParts.join(','));
    }

    // Keyset: traemos las filas anteriores al cursor. Combina con AND.
    if (before) query = query.lt('created_at', before);

    const { data, error, count } = await query;
    if (error) throw error;

    const rows = (data || []) as unknown as SessionRow[];
    // Si trajimos una página completa, asumimos que hay más y el cursor es el
    // created_at de la última fila. Si vino incompleta, se acabó.
    const nextCursor = rows.length === limit ? rows[rows.length - 1].created_at : null;

    res.json({
      data: rows,
      total: isFirstPage ? count ?? rows.length : undefined,
      nextCursor,
      hasMore: nextCursor !== null,
    });
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

const deletedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(25),
  before: z.string().min(1).optional(), // cursor keyset por created_at del audit log
});

/**
 * Lista las sesiones ELIMINADAS desde el panel admin.
 *
 * Como `deleteSession` hace borrado físico (DELETE + CASCADE), las filas de
 * `sf_sessions` ya no existen — no hay nada que listar ahí. Pero el audit log
 * registró cada borrado (`action='session.deleted'`) con los totales y el VIP en
 * `details`. Reconstruimos la vista desde ahí: cero migración, dato ya guardado.
 *
 * Paginación keyset igual que el historial (cursor `before` por created_at).
 */
export const getDeletedSessions = async (req: Request, res: Response): Promise<void> => {
  const parsed = deletedQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: 'validation-error',
      detail: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }

  const { limit, before } = parsed.data;

  try {
    let query = supabaseAdmin
      .from('sf_audit_log')
      .select('id, created_at, user_id, details')
      .eq('action', 'session.deleted')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (before) query = query.lt('created_at', before);

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data || []) as Array<{
      id: string;
      created_at: string;
      user_id: string | null;
      details: Record<string, any> | null;
    }>;

    const items = rows.map((r) => ({
      audit_id: r.id,
      deleted_at: r.created_at,
      deleted_by: r.user_id,
      session_id: r.details?.deleted_session_id ?? null,
      total_items: r.details?.total_items ?? null,
      total_precio: r.details?.total_precio ?? null,
      vip_user_id: r.details?.vip_user_id ?? null,
      vip_nombre: null as string | null,
      vip_correo: null as string | null,
    }));

    // Resolvemos nombre/correo del VIP dueño de cada sesión borrada (bounded por
    // el tamaño de página) para que la vista no muestre solo UUIDs.
    const vipIds = [...new Set(items.map((i) => i.vip_user_id).filter(Boolean))] as string[];
    if (vipIds.length > 0) {
      const { data: profs } = await supabaseAdmin
        .from('profiles')
        .select('id, nombre, correo')
        .in('id', vipIds);
      const nameMap = new Map<string, { nombre: string | null; correo: string | null }>();
      (profs || []).forEach((p: any) => nameMap.set(p.id, { nombre: p.nombre, correo: p.correo }));
      items.forEach((i) => {
        if (!i.vip_user_id) return;
        const p = nameMap.get(i.vip_user_id);
        i.vip_nombre = p?.nombre ?? null;
        i.vip_correo = p?.correo ?? null;
      });
    }

    const nextCursor = rows.length === limit ? rows[rows.length - 1].created_at : null;
    res.json({ data: items, nextCursor, hasMore: nextCursor !== null });
  } catch (error: any) {
    console.error('Error en getDeletedSessions:', error);
    res.status(500).json({ error: error.message || 'Error obteniendo sesiones eliminadas' });
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
        total_precio,
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
      .select('codigo_barras, nombre_producto, cantidad, unidad_medida, posicion, pasillo, pasillo_orden, f120_id, precio_unitario')
      .eq('session_id', id)
      .order('posicion', { ascending: true, nullsFirst: false });

    if (itemsErr) throw itemsErr;

    res.json({ session, items: items || [] });
  } catch (error: any) {
    console.error('Error en getSessionDetail:', error);
    res.status(500).json({ error: error.message || 'Error obteniendo detalle' });
  }
};

/**
 * Elimina una sesión completa desde el panel admin.
 *
 * Validaciones (evitan errores y borrados silenciosos):
 *  1. El id debe ser un UUID válido (400 si no).
 *  2. La sesión debe existir (404 si no) — así el frontend distingue
 *     "ya no estaba" de un fallo real.
 *
 * El borrado de `sf_session_items` y `sf_qr_tokens` es automático por las FK
 * con ON DELETE CASCADE. `sf_audit_log` conserva sus filas (FK SET NULL).
 * Registramos `session.deleted` con el id en `details` (NO en session_id, que
 * apuntaría a una fila ya borrada y violaría la FK).
 */
export const deleteSession = async (req: Request, res: Response): Promise<void> => {
  const parsed = detailParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation-error', detail: 'id debe ser UUID' });
    return;
  }

  const { id } = parsed.data;

  try {
    const { data: existing, error: findErr } = await supabaseAdmin
      .from('sf_sessions')
      .select('id, total_items, total_precio, vip_user_id')
      .eq('id', id)
      .single();

    if (findErr || !existing) {
      res.status(404).json({ error: 'session-not-found', detail: 'La sesión no existe' });
      return;
    }

    const { error: delErr } = await supabaseAdmin
      .from('sf_sessions')
      .delete()
      .eq('id', id);

    if (delErr) throw delErr;

    await logAudit({
      action: 'session.deleted',
      sessionId: null,
      userId: req.user?.id ?? null,
      details: {
        deleted_session_id: id,
        total_items: (existing as any).total_items ?? null,
        total_precio: (existing as any).total_precio ?? null,
        vip_user_id: (existing as any).vip_user_id ?? null,
      },
    });

    res.json({ success: true, id });
  } catch (error: any) {
    console.error('Error en deleteSession:', error);
    res.status(500).json({ error: error.message || 'Error eliminando la sesión' });
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
        sede_id,
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
      sede_id: string | null;
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

    // ---- Ítems del período (paginado, hasta 20k) para los agregados ----
    // Filtramos por fecha (y sede) sobre la tabla embebida sf_sessions.
    const ITEM_PAGE = 1000;
    const itemRows: any[] = [];
    for (let from = 0; from < 20000; from += ITEM_PAGE) {
      let iq = supabaseAdmin
        .from('sf_session_items')
        .select(
          'pasillo, pasillo_orden, nombre_producto, codigo_barras, cantidad, sf_sessions!inner(created_at, sede_id)'
        )
        .gte('sf_sessions.created_at', sinceIso)
        .range(from, from + ITEM_PAGE - 1);
      if (sedeId) iq = iq.eq('sf_sessions.sede_id', sedeId);
      const { data: page, error: pErr } = await iq;
      if (pErr) throw pErr;
      if (!page || page.length === 0) break;
      itemRows.push(...page);
      if (page.length < ITEM_PAGE) break;
    }

    const sessionOf = (r: any) => (Array.isArray(r.sf_sessions) ? r.sf_sessions[0] : r.sf_sessions);

    // Agregado GLOBAL de pasillos + POR SEDE (pasillos calientes y productos top).
    const pasilloMap = new Map<string, { pasillo: string; pasillo_orden: number; items: number }>();
    const pasillosPorSedeMap = new Map<string, Map<string, { pasillo: string; pasillo_orden: number; items: number }>>();
    const productosPorSedeMap = new Map<string, Map<string, { codigo_barras: string; nombre: string; total: number }>>();

    itemRows.forEach((r: any) => {
      const sid: string | null = sessionOf(r)?.sede_id ?? null;
      const key = r.pasillo || 'Sin clasificar';
      const orden = r.pasillo_orden ?? 999;
      const cant = Number(r.cantidad || 0) || 1;

      const g = pasilloMap.get(key) || { pasillo: key, pasillo_orden: orden, items: 0 };
      g.items += 1;
      pasilloMap.set(key, g);

      if (!sid) return;

      let pm = pasillosPorSedeMap.get(sid);
      if (!pm) { pm = new Map(); pasillosPorSedeMap.set(sid, pm); }
      const ps = pm.get(key) || { pasillo: key, pasillo_orden: orden, items: 0 };
      ps.items += 1;
      pm.set(key, ps);

      let prm = productosPorSedeMap.get(sid);
      if (!prm) { prm = new Map(); productosPorSedeMap.set(sid, prm); }
      const codigo = r.codigo_barras || 's/c';
      const pr = prm.get(codigo) || { codigo_barras: codigo, nombre: r.nombre_producto || 'Producto', total: 0 };
      pr.total += cant;
      prm.set(codigo, pr);
    });

    const pasillos = Array.from(pasilloMap.values()).sort((a, b) => a.pasillo_orden - b.pasillo_orden);

    // ---- Nombres: sedes (wc_sedes) y pasillos (catálogo sf_sede_pasillos) ----
    const sedeIds = new Set<string>();
    rows.forEach((r) => r.sede_id && sedeIds.add(r.sede_id));
    pasillosPorSedeMap.forEach((_v, k) => sedeIds.add(k));

    const sedeInfo = new Map<string, { nombre: string; slug: string }>();
    if (sedeIds.size > 0) {
      const { data: sedeRows } = await supabaseAdmin
        .from('wc_sedes')
        .select('id, nombre, slug')
        .in('id', Array.from(sedeIds));
      (sedeRows || []).forEach((s: any) => sedeInfo.set(s.id, { nombre: s.nombre, slug: s.slug }));
    }

    const slugs = [...new Set(Array.from(sedeInfo.values()).map((s) => s.slug))];
    const pasilloNombre = new Map<string, string>(); // `${slug}|${pasillo}` -> nombre
    if (slugs.length > 0) {
      const { data: catRows } = await supabaseAdmin
        .from('sf_sede_pasillos')
        .select('sede_slug, pasillo, nombre')
        .in('sede_slug', slugs);
      (catRows || []).forEach((c: any) => pasilloNombre.set(`${c.sede_slug}|${c.pasillo}`, c.nombre));
    }
    const nombreDePasillo = (slug: string, pasillo: string): string => {
      if (pasillo === 'Otros') return 'Otros';
      if (pasillo === 'Sin clasificar') return 'Sin clasificar';
      return (
        pasilloNombre.get(`${slug}|${pasillo}`) ||
        (/^\d+$/.test(pasillo) ? `Pasillo ${pasillo}` : pasillo)
      );
    };

    // Sesiones e ítems por sede.
    const sedeAggMap = new Map<string, { sede_id: string; sessions: number; items: number }>();
    rows.forEach((r) => {
      if (!r.sede_id) return;
      const cur = sedeAggMap.get(r.sede_id) || { sede_id: r.sede_id, sessions: 0, items: 0 };
      cur.sessions += 1;
      cur.items += Number(r.total_items || 0);
      sedeAggMap.set(r.sede_id, cur);
    });
    const porSede = Array.from(sedeAggMap.values())
      .map((s) => ({ ...s, nombre: sedeInfo.get(s.sede_id)?.nombre || 'Sede' }))
      .sort((a, b) => b.sessions - a.sessions);

    // Pasillos más calientes por sede (con nombre legible, top 8).
    const pasillosPorSede = Array.from(pasillosPorSedeMap.entries())
      .map(([sid, pm]) => {
        const info = sedeInfo.get(sid);
        const slug = info?.slug || '';
        const lista = Array.from(pm.values())
          .map((p) => ({ pasillo: p.pasillo, nombre: nombreDePasillo(slug, p.pasillo), items: p.items }))
          .sort((a, b) => b.items - a.items)
          .slice(0, 8);
        const total = lista.reduce((acc, p) => acc + p.items, 0);
        return { sede_id: sid, sede_nombre: info?.nombre || 'Sede', total, pasillos: lista };
      })
      .sort((a, b) => b.total - a.total);

    // Top productos por sede (por unidades, top 8).
    const productosPorSede = Array.from(productosPorSedeMap.entries())
      .map(([sid, prm]) => {
        const info = sedeInfo.get(sid);
        const lista = Array.from(prm.values())
          .sort((a, b) => b.total - a.total)
          .slice(0, 8);
        const total = lista.reduce((acc, p) => acc + p.total, 0);
        return { sede_id: sid, sede_nombre: info?.nombre || 'Sede', total, productos: lista };
      })
      .sort((a, b) => b.total - a.total);

    res.json({
      since: sinceIso,
      days,
      daily,
      states,
      topVips,
      hourly,
      pasillos,
      porSede,
      pasillosPorSede,
      productosPorSede,
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

// ============================================================
// MAPA DE LA TIENDA — catálogo de pasillos + layout (posiciones) por sede
// ============================================================

const layoutNodeSchema = z.object({
  nodo_id: z.string().trim().min(1).max(64),
  tipo: z.enum(['pasillo', 'entrada', 'caja']).default('pasillo'),
  etiqueta: z.string().trim().max(120).nullish(),
  x: z.number(),
  y: z.number(),
  ancho: z.number().positive().nullish(),
  alto: z.number().positive().nullish(),
});

const saveLayoutSchema = z.object({
  nodos: z.array(layoutNodeSchema).max(200),
});

/** Resuelve el slug de la sede (wc_sedes) desde el UUID de `req.sedeId`. */
const resolveSedeSlug = async (sedeId: string | undefined): Promise<string | null> => {
  if (!sedeId) return null;
  const { data } = await supabaseAdmin
    .from('wc_sedes')
    .select('slug')
    .eq('id', sedeId)
    .single();
  return (data as { slug?: string } | null)?.slug ?? null;
};

/**
 * Devuelve el catálogo de pasillos de la sede activa + las posiciones guardadas.
 * El frontend mergea: para cada pasillo del catálogo busca su nodo guardado;
 * si no existe, lo auto-posiciona (dagre). Más los nodos especiales entrada/caja.
 * Requiere una sede concreta (X-Sede-ID); con "todas" no hay layout que mostrar.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const getSedeLayout = async (req: Request, res: Response): Promise<void> => {
  try {
    // El visor de recorrido pasa ?sede_id= (la sede de la sesión), que tiene
    // prioridad sobre la sede activa del header (el admin puede ver "todas").
    const q = typeof req.query.sede_id === 'string' ? req.query.sede_id : undefined;
    const overrideSedeId = q && UUID_RE.test(q) ? q : undefined;
    const sedeSlug = await resolveSedeSlug(overrideSedeId || req.sedeId);
    if (!sedeSlug) {
      res.status(400).json({
        error: 'missing-sede',
        detail: 'Seleccioná una sede específica para ver o editar su mapa',
      });
      return;
    }

    const { data: catalogo, error: catErr } = await supabaseAdmin
      .from('sf_sede_pasillos')
      .select('pasillo, nombre, pasillo_orden')
      .eq('sede_slug', sedeSlug)
      .order('pasillo_orden', { ascending: true });
    if (catErr) throw catErr;

    const { data: nodos, error: layErr } = await supabaseAdmin
      .from('sf_sede_layout')
      .select('nodo_id, tipo, etiqueta, x, y, ancho, alto')
      .eq('sede_slug', sedeSlug);
    if (layErr) throw layErr;

    res.json({ sede_slug: sedeSlug, catalogo: catalogo || [], nodos: nodos || [] });
  } catch (error: any) {
    console.error('Error en getSedeLayout:', error);
    res.status(500).json({ error: error.message || 'Error obteniendo el mapa de la sede' });
  }
};

/**
 * Guarda el layout completo de la sede activa (reemplaza el estado anterior).
 * Estrategia segura: upsert de los nodos entrantes primero (nunca se pierde
 * data), luego borra los nodos que ya no están en el set. Si el borrado de
 * obsoletos falla, queda algún nodo de más (inocuo, se limpia al próximo save).
 */
export const saveSedeLayout = async (req: Request, res: Response): Promise<void> => {
  const parsed = saveLayoutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'validation-error',
      detail: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }

  try {
    const sedeSlug = await resolveSedeSlug(req.sedeId);
    if (!sedeSlug) {
      res.status(400).json({
        error: 'missing-sede',
        detail: 'Seleccioná una sede específica para guardar su mapa',
      });
      return;
    }

    const now = new Date().toISOString();
    const rows = parsed.data.nodos.map((n) => ({
      sede_slug: sedeSlug,
      nodo_id: n.nodo_id,
      tipo: n.tipo,
      etiqueta: n.etiqueta ?? null,
      x: n.x,
      y: n.y,
      ancho: n.ancho ?? null,
      alto: n.alto ?? null,
      updated_at: now,
    }));

    if (rows.length > 0) {
      const { error: upErr } = await supabaseAdmin
        .from('sf_sede_layout')
        .upsert(rows, { onConflict: 'sede_slug,nodo_id' });
      if (upErr) throw upErr;
    }

    // Borrar nodos obsoletos (los que ya no manda el editor).
    const keep = new Set(rows.map((r) => r.nodo_id));
    const { data: existing } = await supabaseAdmin
      .from('sf_sede_layout')
      .select('nodo_id')
      .eq('sede_slug', sedeSlug);
    const stale = (existing || [])
      .map((e: any) => e.nodo_id as string)
      .filter((id) => !keep.has(id));
    if (stale.length > 0) {
      await supabaseAdmin
        .from('sf_sede_layout')
        .delete()
        .eq('sede_slug', sedeSlug)
        .in('nodo_id', stale);
    }

    res.json({ success: true, sede_slug: sedeSlug, count: rows.length });
  } catch (error: any) {
    console.error('Error en saveSedeLayout:', error);
    res.status(500).json({ error: error.message || 'Error guardando el mapa de la sede' });
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
