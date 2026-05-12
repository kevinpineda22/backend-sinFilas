import { useCallback, useEffect, useState } from 'react';
import { getAdminVips } from '../../api/sfApi';
import { SFHistoryView } from './SFHistoryView';
import './SFAdminShared.css';

const initial = (s) => (s || '?').trim().charAt(0).toUpperCase();

export const SFVipsView = ({ refreshSignal, showToast, onViewDetail }) => {
  const [vips, setVips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedVip, setSelectedVip] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAdminVips();
      setVips(res.data || []);
    } catch (err) {
      console.error('Error vips:', err);
      showToast('No se pudo cargar la lista de VIPs', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load, refreshSignal]);

  if (selectedVip) {
    return (
      <div>
        <div style={{ marginBottom: '16px' }}>
          <button 
            type="button" 
            className="sfa-filter-clear-btn" 
            onClick={() => setSelectedVip(null)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            Volver a Usuarios VIP
          </button>
          <div style={{ padding: '16px', background: 'var(--sfc-card-bg)', borderRadius: 'var(--sfc-radius-sm)', border: '1px solid var(--sfc-glass-border)' }}>
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: 'var(--sfc-text-dark)' }}>Historial de: {selectedVip.nombre}</h2>
            {selectedVip.correo && <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--sfc-text-muted)' }}>{selectedVip.correo}</p>}
          </div>
        </div>
        <SFHistoryView 
          refreshSignal={refreshSignal} 
          showToast={showToast} 
          onViewDetail={onViewDetail} 
          fixedVipId={selectedVip.vip_user_id} 
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="sfa-card sfa-card-padded">
        <div className="sf-admin-loading-block">
          <div className="sf-admin-spinner" />
          <p>Cargando usuarios VIP…</p>
        </div>
      </div>
    );
  }

  if (vips.length === 0) {
    return (
      <div className="sf-admin-empty">
        <p className="sf-admin-empty-title">Sin resultados</p>
        <p className="sf-admin-empty-text">No hay usuarios VIP registrados.</p>
      </div>
    );
  }

  return (
    <div className="sfa-ticket-container">
      <div className="sfa-ticket-grid">
        {vips.map((v) => (
          <div key={v.vip_user_id} className="sfa-ticket-card" onClick={() => setSelectedVip(v)} style={{ cursor: 'pointer' }}>
            <div className="sfa-user-cell" style={{ borderBottom: '1px solid var(--sfc-border)', paddingBottom: '12px', marginBottom: '12px' }}>
              <span className="sfa-avatar sfa-avatar--indigo">
                {initial(v.nombre)}
              </span>
              <div className="sfa-user-info">
                <span className="sfa-user-name" style={{ fontSize: '1rem' }}>{v.nombre}</span>
                {v.correo && <span className="sfa-user-email">{v.correo}</span>}
              </div>
            </div>
            <div className="sfa-ticket-meta" style={{ justifyContent: 'space-between' }}>
              <div className="sfa-meta-item">
                <span className="sfa-badge sfa-badge--qty" style={{ background: 'rgba(99, 102, 241, 0.1)', color: '#4f46e5' }}>{v.sessions} Sesiones</span>
              </div>
              <div className="sfa-meta-item">
                <span className="sfa-badge sfa-badge--qty">{v.items} Ítems</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
