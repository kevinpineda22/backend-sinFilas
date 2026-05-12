import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { getAdminAnalytics } from '../../api/sfApi';
import './SFAdminShared.css';
import './SFIntelligenceView.css';

const PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];

const fmtNumber = (v) => new Intl.NumberFormat('es-CO').format(v || 0);

const DAY_OPTIONS = [
  { value: 7, label: 'Últimos 7 días' },
  { value: 30, label: 'Últimos 30 días' },
  { value: 90, label: 'Últimos 90 días' },
];

const estadoLabel = (estado) => {
  if (estado === 'en_proceso') return 'En Proceso';
  return 'Completada';
};

export const SFIntelligenceView = ({ refreshSignal, showToast }) => {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAdminAnalytics(days);
      setData(res);
    } catch (err) {
      console.error('Error analytics:', err);
      showToast('No se pudo cargar la analítica', 'error');
    } finally {
      setLoading(false);
    }
  }, [days, showToast]);

  useEffect(() => {
    load();
  }, [load, refreshSignal]);

  const dailyData = useMemo(() => {
    if (!data?.daily) return [];
    return data.daily.map((d) => ({
      ...d,
      label: new Date(d.date).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }),
    }));
  }, [data]);

  const stateData = useMemo(() => {
    if (!data?.states) return [];
    return data.states.map((s) => ({ name: estadoLabel(s.estado), value: s.count }));
  }, [data]);

  const hourlyData = useMemo(() => {
    if (!data?.hourly) return [];
    return data.hourly.map((h) => ({ ...h, label: `${String(h.hour).padStart(2, '0')}:00` }));
  }, [data]);

  const topVipsData = useMemo(() => {
    if (!data?.topVips) return [];
    return data.topVips.map((v) => ({
      ...v,
      nombre_corto: v.nombre.length > 16 ? `${v.nombre.slice(0, 14)}…` : v.nombre,
    }));
  }, [data]);

  if (loading && !data) {
    return (
      <div className="sf-admin-loading-block">
        <div className="sf-admin-spinner" />
        <p>Cargando analítica…</p>
      </div>
    );
  }

  return (
    <>
      <div className="sfi-toolbar">
        <div className="sfi-toolbar-period">
          {DAY_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`sfi-period-btn ${days === o.value ? 'active' : ''}`}
              onClick={() => setDays(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {data && (
        <>
          <div className="sfi-totals">
            <div className="sfi-total-card">
              <span className="sfi-total-label">Sesiones</span>
              <span className="sfi-total-value">{fmtNumber(data.totals.sessions)}</span>
            </div>
            <div className="sfi-total-card">
              <span className="sfi-total-label">Ítems escaneados</span>
              <span className="sfi-total-value">{fmtNumber(data.totals.items)}</span>
            </div>
            <div className="sfi-total-card">
              <span className="sfi-total-label">VIPs distintos</span>
              <span className="sfi-total-value">{fmtNumber(data.totals.vips)}</span>
            </div>
          </div>

          <div className="sfi-chart-card">
            <h3 className="sfi-chart-title">Sesiones por día</h3>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={dailyData}>
                <defs>
                  <linearGradient id="sfiAreaSessions" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 13 }}
                />
                <Area
                  type="monotone"
                  dataKey="sessions"
                  name="Sesiones"
                  stroke="#6366f1"
                  strokeWidth={2}
                  fill="url(#sfiAreaSessions)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="sfi-chart-row">
            <div className="sfi-chart-card">
              <h3 className="sfi-chart-title">Hora pico</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={hourlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} interval={1} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 13 }}
                  />
                  <Bar dataKey="sessions" name="Sesiones" fill="#0071e3" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="sfi-chart-card">
              <h3 className="sfi-chart-title">Distribución por estado</h3>
              {stateData.length === 0 ? (
                <p className="sfi-empty-mini">Sin datos para el período</p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={stateData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      innerRadius={45}
                      paddingAngle={2}
                    >
                      {stateData.map((_, i) => (
                        <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 13 }}
                    />
                    <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="sfi-chart-card">
            <h3 className="sfi-chart-title">Top VIPs por sesiones</h3>
            {topVipsData.length === 0 ? (
              <p className="sfi-empty-mini">Sin actividad en el período</p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(220, topVipsData.length * 36)}>
                <BarChart data={topVipsData} layout="vertical" margin={{ left: 16, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="nombre_corto"
                    tick={{ fontSize: 12, fill: '#475569' }}
                    width={140}
                  />
                  <Tooltip
                    contentStyle={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 13 }}
                    formatter={(value, name) => [value, name === 'sessions' ? 'Sesiones' : 'Ítems']}
                  />
                  <Bar dataKey="sessions" name="Sesiones" fill="#a855f7" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </>
      )}
    </>
  );
};

export default SFIntelligenceView;
