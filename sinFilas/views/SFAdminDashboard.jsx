import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAdminStats, getAdminSessionDetail } from '../api/sfApi';
import { SFHistoryView } from './admin/SFHistoryView';
import { SFIntelligenceView } from './admin/SFIntelligenceView';
import { SFSessionDetailModal } from './admin/SFSessionDetailModal';
import { SFVipsView } from './admin/SFVipsView';
import './SFAdminDashboard.css';

const SF_QUOTES = [
  { text: 'La excelencia no es un acto, sino un hábito.', author: 'Aristóteles' },
  { text: 'La calidad no es un acto, es un hábito.', author: 'Aristóteles' },
  { text: 'Quien quiere hacer algo, encuentra un medio. Quien no, una excusa.', author: 'Proverbio árabe' },
  { text: 'Lo que se mide, se mejora.', author: 'Peter Drucker' },
  { text: 'La simplicidad es la máxima sofisticación.', author: 'Leonardo da Vinci' },
];

const getQuote = (offset = 0) => SF_QUOTES[offset % SF_QUOTES.length];

const VIEWS = {
  HISTORY: 'history',
  VIPS: 'vips',
  INTELLIGENCE: 'intelligence',
};

const VIEW_TITLES = {
  [VIEWS.HISTORY]: { title: 'Historial de Sesiones', subtitle: 'Todas las sesiones VIP registradas en Sin Filas' },
  [VIEWS.VIPS]: { title: 'Usuarios VIP', subtitle: 'Listado de usuarios y su historial de operaciones' },
  [VIEWS.INTELLIGENCE]: { title: 'Inteligencia', subtitle: 'Métricas operativas y comportamiento del piso' },
};

const Icon = ({ name, size = 18 }) => {
  const paths = {
    back: <><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></>,
    refresh: <><path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /></>,
    cart: <><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></>,
    box: <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></>,
    users: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
    history: <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>,
    trash: <><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>,
    chart: <><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></>,
    today: <><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>,
    qr: <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></>,
  };
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {paths[name] || null}
    </svg>
  );
};

const KpiCard = ({ icon, label, value, accent }) => (
  <div className="sf-admin-kpi-card">
    <div className={`sf-admin-kpi-icon sf-admin-kpi-icon--${accent}`}>
      <Icon name={icon} size={26} />
    </div>
    <div className="sf-admin-kpi-body">
      <p className="sf-admin-kpi-label">{label}</p>
      <p className="sf-admin-kpi-value">{value}</p>
    </div>
  </div>
);

const NavButton = ({ icon, label, active, onClick, badge, badgeColor = 'red' }) => (
  <button
    type="button"
    className={`sf-admin-sidebar-button ${active ? 'active' : ''}`}
    onClick={onClick}
  >
    <Icon name={icon} size={18} />
    <span>{label}</span>
    {typeof badge === 'number' && (
      <span className={`sf-admin-sidebar-badge sf-admin-sidebar-badge--${badgeColor}`}>{badge}</span>
    )}
  </button>
);

export const SFAdminDashboard = () => {
  const navigate = useNavigate();
  const [currentView, setCurrentView] = useState(VIEWS.HISTORY);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [stats, setStats] = useState({
    totalSessions: 0,
    totalItems: 0,
    activeVips: 0,
    cancelled: 0,
    registered: 0,
    sessionsToday: 0,
  });
  const [statsLoading, setStatsLoading] = useState(true);
  const [refreshSignal, setRefreshSignal] = useState(0);

  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);

  const [detailId, setDetailId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const showToast = useCallback((msg, type = 'success') => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const data = await getAdminStats();
      setStats(data);
    } catch (err) {
      console.error('Error cargando stats:', err);
      showToast('No se pudieron cargar las métricas', 'error');
    } finally {
      setStatsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const handleRefresh = useCallback(() => {
    loadStats();
    setRefreshSignal((s) => s + 1);
  }, [loadStats]);

  const handleViewDetail = useCallback(
    async (sessionId) => {
      setDetailId(sessionId);
      setDetailLoading(true);
      setDetail(null);
      try {
        const data = await getAdminSessionDetail(sessionId);
        setDetail(data);
      } catch (err) {
        console.error('Error cargando detalle:', err);
        showToast('No se pudo cargar el detalle de la sesión', 'error');
        setDetailId(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [showToast]
  );

  const closeDetail = () => {
    setDetailId(null);
    setDetail(null);
  };

  const handleNav = (view) => {
    setCurrentView(view);
    setSidebarOpen(false);
  };

  const quote = useMemo(() => getQuote(currentView.length), [currentView]);
  const header = VIEW_TITLES[currentView];

  return (
    <div className="sf-admin-layout">
      <button
        type="button"
        className={`sf-admin-mobile-toggle ${sidebarOpen ? 'open' : ''}`}
        onClick={() => setSidebarOpen((s) => !s)}
        aria-label="Toggle menú"
      >
        <span />
        <span />
        <span />
      </button>

      {sidebarOpen && (
        <div className="sf-admin-sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={`sf-admin-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sf-admin-sidebar-header">
          <button
            type="button"
            className="sf-admin-back-button"
            onClick={() => navigate('/acceso')}
            aria-label="Volver a accesos"
          >
            <Icon name="back" size={18} />
          </button>
          <div className="sf-admin-sidebar-logo">
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </svg>
          </div>
          <h2 className="sf-admin-sidebar-title">Panel Sin Filas</h2>
        </div>

        <nav className="sf-admin-sidebar-nav">
          <div className="sf-admin-nav-section-label">OPERACIÓN</div>
          <NavButton
            icon="history"
            label="Sesiones"
            active={currentView === VIEWS.HISTORY}
            onClick={() => handleNav(VIEWS.HISTORY)}
            badge={stats.totalSessions}
            badgeColor="blue"
          />
          <NavButton
            icon="users"
            label="Usuarios VIP"
            active={currentView === VIEWS.VIPS}
            onClick={() => handleNav(VIEWS.VIPS)}
            badge={stats.activeVips}
            badgeColor="indigo"
          />

          <div className="sf-admin-nav-section-label">ANALYTICS</div>
          <NavButton
            icon="chart"
            label="Inteligencia"
            active={currentView === VIEWS.INTELLIGENCE}
            onClick={() => handleNav(VIEWS.INTELLIGENCE)}
          />
        </nav>

        <div className="sf-admin-sidebar-footer">
          <div className="sf-admin-sidebar-footer-quote">
            «{quote.text}»
            <strong>— {quote.author}</strong>
          </div>
        </div>
      </aside>

      <main className="sf-admin-content">
        <header className="sf-admin-content-header">
          <div className="sf-admin-content-header-text">
            <h1>{header.title}</h1>
            <p className="sf-admin-content-header-quote">{header.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            className="sf-admin-refresh-btn"
            disabled={statsLoading}
          >
            <Icon name="refresh" size={16} />
            Sincronizar
          </button>
        </header>

        <section className="sf-admin-kpi-grid">
          <KpiCard icon="today" label="Sesiones Hoy" value={stats.sessionsToday} accent="blue" />
          <KpiCard icon="cart" label="Sesiones Totales" value={stats.totalSessions} accent="indigo" />
          <KpiCard icon="box" label="Ítems Escaneados" value={Math.round(stats.totalItems)} accent="purple" />
          <KpiCard icon="users" label="VIPs Activos" value={stats.activeVips} accent="pink" />
        </section>

        <section className="sf-admin-view-container">
          {currentView === VIEWS.HISTORY && (
            <SFHistoryView
              refreshSignal={refreshSignal}
              showToast={showToast}
              onViewDetail={handleViewDetail}
            />
          )}
          {currentView === VIEWS.VIPS && (
            <SFVipsView
              refreshSignal={refreshSignal}
              showToast={showToast}
              onViewDetail={handleViewDetail}
            />
          )}
          {currentView === VIEWS.INTELLIGENCE && (
            <SFIntelligenceView refreshSignal={refreshSignal} showToast={showToast} />
          )}
        </section>
      </main>

      <SFSessionDetailModal
        isOpen={detailId !== null}
        loading={detailLoading}
        detail={detail}
        onClose={closeDetail}
      />

      <div className="sf-admin-toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`sf-admin-toast sf-admin-toast--${t.type}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
};

export default SFAdminDashboard;
