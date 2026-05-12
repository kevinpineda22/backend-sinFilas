import { useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { generateManifestQRValue } from '../../utils/gs1Utils';
import './SFSessionDetailModal.css';

const formatDate = (iso) =>
  new Date(iso).toLocaleString('es-CO', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const estadoLabel = (estado) => (estado === 'en_proceso' ? 'EN PROCESO' : 'COMPLETADA');
const estadoClass = (estado) => (estado === 'en_proceso' ? 'en_proceso' : 'completada');

export const SFSessionDetailModal = ({ isOpen, loading, detail, onClose }) => {
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const session = detail?.session;
  const items = detail?.items || [];
  const vipName = session?.profiles?.nombre || 'Sin nombre';
  const vipEmail = session?.profiles?.correo || '';

  const qrValue = items.length > 0 ? generateManifestQRValue(items) : null;

  return (
    <div className="sfd-overlay" onClick={onClose}>
      <div className="sfd-content" onClick={(e) => e.stopPropagation()}>
        <header className="sfd-header">
          <div className="sfd-header-left">
            <div className="sfd-icon-badge">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="9" y1="21" x2="9" y2="9" />
              </svg>
            </div>
            <div>
              <h2 className="sfd-id">
                {loading || !session ? 'Cargando…' : `Sesión #${session.id.slice(0, 8)}`}
              </h2>
              {session && (
                <p className="sfd-date">{formatDate(session.created_at)}</p>
              )}
            </div>
          </div>
          <button type="button" className="sfd-close" onClick={onClose} aria-label="Cerrar">×</button>
        </header>

        <div className="sfd-body">
          {loading || !session ? (
            <div className="sfd-loading">
              <div className="sf-admin-spinner" />
              <p>Cargando detalle…</p>
            </div>
          ) : (
            <>
              <section className="sfd-info-grid">
                <div className="sfd-info-card">
                  <p className="sfd-section-title">Usuario VIP</p>
                  <p className="sfd-info-main">{vipName}</p>
                  {vipEmail && <p className="sfd-info-sub">{vipEmail}</p>}
                </div>
                <div className="sfd-info-card">
                  <p className="sfd-section-title">Estado</p>
                  <span className={`sfa-badge sfa-badge--${estadoClass(session.estado)}`}>
                    {estadoLabel(session.estado)}
                  </span>
                  <p className="sfd-info-sub" style={{ marginTop: 8 }}>
                    Total registrado: <strong>{session.total_items}</strong> ítems
                  </p>
                </div>
              </section>

              {qrValue && session.estado === 'completada' && (
                <section className="sfd-qr-section" style={{ textAlign: 'center', margin: '20px 0', padding: '20px', background: 'var(--sfc-bg)', borderRadius: 'var(--sfc-radius-sm)' }}>
                  <p className="sfd-section-title" style={{ marginBottom: '16px' }}>Código QR de Caja</p>
                  <QRCodeSVG value={qrValue} size={200} level="L" includeMargin={true} style={{ background: '#fff', padding: '8px', borderRadius: '8px' }} />
                </section>
              )}

              <section className="sfd-products">
                <div className="sfd-products-title">
                  Productos escaneados <span>{items.length}</span>
                </div>

                {items.length === 0 ? (
                  <div className="sfd-empty">No hay ítems registrados para esta sesión.</div>
                ) : (
                  <ul className="sfd-products-list">
                    {items.map((item, idx) => (
                      <li key={`${item.codigo_barras}-${idx}`} className="sfd-product-row">
                        <div className="sfd-product-qty">
                          {item.cantidad} <span>{item.unidad_medida}</span>
                        </div>
                        <div className="sfd-product-main">
                          <p className="sfd-product-name">{item.nombre_producto || 'Producto'}</p>
                          <p className="sfd-product-code">{item.codigo_barras}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>

        <footer className="sfd-footer">
          <button type="button" className="sfd-btn-secondary" onClick={onClose}>Cerrar</button>
        </footer>
      </div>
    </div>
  );
};

export default SFSessionDetailModal;
