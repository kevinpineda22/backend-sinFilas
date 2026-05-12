import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAdminSessions } from '../../api/sfApi';
import './SFAdminShared.css';

const initial = (s) => (s || '?').trim().charAt(0).toUpperCase();

const STATE_OPTIONS = [
  { value: '', label: 'Todos los estados' },
  { value: 'completada', label: 'Completada' },
  { value: 'en_proceso', label: 'En Proceso' },
];

const estadoLabel = (estado) => {
  if (estado === 'en_proceso') return 'EN PROCESO';
  return 'COMPLETADA';
};

const estadoClass = (estado) => (estado === 'en_proceso' ? 'en_proceso' : 'completada');

const avatarTone = (estado) => (estado === 'en_proceso' ? 'orange' : 'indigo');

export const SFHistoryView = ({ refreshSignal, showToast, onViewDetail, fixedVipId }) => {
  const [sessions, setSessions] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [estado, setEstado] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: 100 };
      if (estado) params.estado = estado;
      if (search) params.search = search;
      if (fixedVipId) params.vip_user_id = fixedVipId;
      const res = await getAdminSessions(params);
      setSessions(res.data || []);
      setTotal(res.total || 0);
    } catch (err) {
      console.error('Error history:', err);
      showToast('No se pudo cargar el historial', 'error');
    } finally {
      setLoading(false);
    }
  }, [estado, search, showToast]);

  useEffect(() => {
    load();
  }, [load, refreshSignal]);

  const onSubmitSearch = (e) => {
    e.preventDefault();
    setSearch(searchInput.trim());
  };

  const clearFilters = () => {
    setEstado('');
    setSearch('');
    setSearchInput('');
  };

  const hasFilters = estado !== '' || search !== '';

  const groupedSessions = useMemo(() => {
    if (!sessions.length) return [];
    const groupsMap = {};
    sessions.forEach((s) => {
      const dateStr = new Date(s.created_at).toLocaleDateString('es-CO', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      if (!groupsMap[dateStr]) groupsMap[dateStr] = [];
      groupsMap[dateStr].push(s);
    });
    return Object.entries(groupsMap).map(([date, items]) => ({ date, items }));
  }, [sessions]);

  return (
    <>
      <form className="sfa-filter-bar" onSubmit={onSubmitSearch}>
        <div className="sfa-filter-group">
          <label htmlFor="sfa-history-search">Buscar</label>
          <input
            id="sfa-history-search"
            type="text"
            className="sfa-filter-input"
            placeholder="Nombre o correo del VIP, ID de sesión…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <div className="sfa-filter-group">
          <label htmlFor="sfa-history-estado">Estado</label>
          <select
            id="sfa-history-estado"
            className="sfa-filter-select"
            value={estado}
            onChange={(e) => setEstado(e.target.value)}
          >
            {STATE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="sf-admin-refresh-btn">
          Aplicar
        </button>
        {hasFilters && (
          <button type="button" className="sfa-filter-clear-btn" onClick={clearFilters}>
            Limpiar
          </button>
        )}
      </form>

      <div className="sfa-filter-results">
        Mostrando <strong>{sessions.length}</strong> de <strong>{total}</strong> sesiones
      </div>

      <div className="sfa-view-wrapper" style={{ paddingBottom: '20px' }}>
        {loading ? (
          <div className="sfa-card sfa-card-padded">
            <div className="sf-admin-loading-block">
              <div className="sf-admin-spinner" />
              <p>Cargando historial…</p>
            </div>
          </div>
        ) : sessions.length === 0 ? (
          <div className="sf-admin-empty">
            <div className="sf-admin-empty-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
            </div>
            <p className="sf-admin-empty-title">Sin resultados</p>
            <p className="sf-admin-empty-text">No hay sesiones que coincidan con los filtros.</p>
          </div>
        ) : (
          <div className="sfa-ticket-container">
            {groupedSessions.map(({ date, items }) => (
              <div key={date} className="sfa-date-group">
                <div className="sfa-date-separator">
                  <span className="sfa-date-label">{date}</span>
                  <span className="sfa-date-count">{items.length}</span>
                  <div className="sfa-date-line" />
                </div>
                <div className="sfa-ticket-grid">
                  {items.map((s) => {
                    const vipName = s.profiles?.nombre || 'Sin nombre';
                    return (
                      <div key={s.id} className="sfa-ticket-card" onClick={() => onViewDetail(s.id)}>
                        <div className="sfa-ticket-header">
                          <span className="sfa-ticket-id">#{s.id.slice(0, 8)}</span>
                          <span className="sfa-ticket-date">
                            {new Date(s.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="sfa-user-cell">
                          <span className={`sfa-avatar sfa-avatar--${avatarTone(s.estado)}`}>
                            {initial(vipName)}
                          </span>
                          <div className="sfa-user-info">
                            <span className="sfa-user-name">{vipName}</span>
                            {s.profiles?.correo && <span className="sfa-user-email">{s.profiles.correo}</span>}
                          </div>
                        </div>
                        <div className="sfa-ticket-meta">
                          <div className="sfa-meta-item">
                            <span className="sfa-badge sfa-badge--qty">{s.total_items} ítems</span>
                          </div>
                          <span className={`sfa-badge sfa-badge--${estadoClass(s.estado)}`}>
                            {estadoLabel(s.estado)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
};

export default SFHistoryView;