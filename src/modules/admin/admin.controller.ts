import { Request, Response } from 'express';
import { supabaseAdmin } from '../../shared/db/supabaseClient';

export const getDashboardStats = async (req: Request, res: Response): Promise<void> => {
  try {
    // 1. Total de Sesiones
    const { count: totalSessions, error: err1 } = await supabaseAdmin
      .from('sf_sessions')
      .select('*', { count: 'exact', head: true });

    if (err1) throw err1;

    // 2. Total de Items Procesados
    // Sumamos la columna cantidad de sf_session_items
    const { data: itemsData, error: err2 } = await supabaseAdmin
      .from('sf_session_items')
      .select('cantidad');
      
    if (err2) throw err2;
    
    const totalItems = itemsData.reduce((acc, item) => acc + Number(item.cantidad), 0);

    // 3. Usuarios VIP Activos (que han hecho al menos una sesin)
    const { data: vipsData, error: err3 } = await supabaseAdmin
      .from('sf_sessions')
      .select('vip_user_id');

    if (err3) throw err3;

    const uniqueVips = new Set(vipsData.map(s => s.vip_user_id)).size;

    res.json({
      totalSessions: totalSessions || 0,
      totalItems: totalItems || 0,
      activeVips: uniqueVips
    });
  } catch (error: any) {
    console.error('Error en getDashboardStats:', error);
    res.status(500).json({ error: error.message || 'Error obteniendo analticas' });
  }
};

export const getSessionsHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    // Obtenemos las ltimas 50 sesiones
    const { data, error } = await supabaseAdmin
      .from('sf_sessions')
      .select(`
        id,
        estado,
        total_items,
        created_at,
        vip_user_id,
        sede_id,
        sf_qr_tokens ( used_at )
      `)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    res.json(data);
  } catch (error: any) {
    console.error('Error en getSessionsHistory:', error);
    res.status(500).json({ error: error.message || 'Error obteniendo historial' });
  }
};

export const getVipUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    // Obtenemos a todos los usuarios independientemente del rol.
    // El cliente solicitó que cualquier empleado del sistema (independientemente de su rol principal)
    // pueda escanear en Sin Filas durante días de alta carga, solo dándoles acceso a la URL.
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('user_id, nombre, correo, role')
      .order('nombre', { ascending: true });

    if (error) throw error;

    res.json(data);
  } catch (error: any) {
    console.error('Error en getVipUsers:', error);
    res.status(500).json({ error: error.message || 'Error obteniendo usuarios VIP' });
  }
};
