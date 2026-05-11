import { useState, useEffect } from 'react';
import { getAdminStats, getAdminSessions, getAdminUsers } from '../api/sfApi';
import './AdminDashboard.css';

export const AdminDashboard = () => {
  const [activeTab, setActiveTab] = useState('historial');
  const [stats, setStats] = useState({ totalSessions: 0, totalItems: 0, activeVips: 0 });
  const [sessions, setSessions] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    setLoading(true);
    try {
      const [statsData, sessionsData, usersData] = await Promise.all([
        getAdminStats(),
        getAdminSessions(),
        getAdminUsers()
      ]);
      setStats(statsData);
      setSessions(sessionsData);
      setUsers(usersData);
    } catch (error) {
      console.error("Error cargando dashboard:", error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (isoString) => {
    return new Date(isoString).toLocaleString('es-CO', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
    });
  };

  const getUserName = (id) => {
    const user = users.find(u => u.user_id === id);
    return user ? (user.nombre || 'Sin nombre') : 'Usuario Desconocido';
  };

  if (loading) {
    return (
      <div className="sfa-loading">
        <svg className="sfa-spinner" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
          <circle className="sfa-spinner-track" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="sfa-spinner-head" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <p>Cargando analíticas...</p>
      </div>
    );
  }

  return (
    <div className="sfa-container">
      <header className="sfa-header">
        <div className="sfa-header-title">
          <div className="sfa-header-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="3" y1="9" x2="21" y2="9"></line>
              <line x1="9" y1="21" x2="9" y2="9"></line>
            </svg>
          </div>
          <div>
            <h1>Panel Administrativo VIP</h1>
            <p>Gestión de sesiones y usuarios de Sin Filas</p>
          </div>
        </div>
        <button onClick={loadDashboardData} className="sfa-btn-refresh">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 2v6h-6"></path>
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path>
            <path d="M3 22v-6h6"></path>
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path>
          </svg>
          Actualizar
        </button>
      </header>

      <section className="sfa-kpi-grid">
        <div className="sfa-kpi-card">
          <div className="sfa-kpi-icon sfa-kpi-icon--blue">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="9" cy="21" r="1"></circle>
              <circle cx="20" cy="21" r="1"></circle>
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
            </svg>
          </div>
          <div className="sfa-kpi-body">
            <p className="sfa-kpi-label">Total Sesiones</p>
            <p className="sfa-kpi-value">{stats.totalSessions}</p>
          </div>
        </div>

        <div className="sfa-kpi-card">
          <div className="sfa-kpi-icon sfa-kpi-icon--green">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
              <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
              <line x1="12" y1="22.08" x2="12" y2="12"></line>
            </svg>
          </div>
          <div className="sfa-kpi-body">
            <p className="sfa-kpi-label">Total Items Escaneados</p>
            <p className="sfa-kpi-value">{Math.round(stats.totalItems)}</p>
          </div>
        </div>

        <div className="sfa-kpi-card">
          <div className="sfa-kpi-icon sfa-kpi-icon--purple">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
          </div>
          <div className="sfa-kpi-body">
            <p className="sfa-kpi-label">Usuarios VIP</p>
            <p className="sfa-kpi-value">{stats.activeVips}</p>
          </div>
        </div>
      </section>

      <section className="sfa-card">
        <div className="sfa-tabs-nav">
          <button
            onClick={() => setActiveTab('historial')}
            className={`sfa-tab ${activeTab === 'historial' ? 'sfa-tab--active' : ''}`}
          >
            Historial de Sesiones
          </button>
          <button
            onClick={() => setActiveTab('usuarios')}
            className={`sfa-tab ${activeTab === 'usuarios' ? 'sfa-tab--active' : ''}`}
          >
            Usuarios Registrados
          </button>
        </div>

        {activeTab === 'historial' && (
          <div className="sfa-table-wrap">
            <table className="sfa-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Empleado VIP</th>
                  <th className="sfa-th-center">Items</th>
                  <th>Estado</th>
                  <th>Cobrado en Caja</th>
                </tr>
              </thead>
              <tbody>
                {sessions.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="sfa-empty">
                      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"></path>
                      </svg>
                      <p>No hay sesiones registradas aún</p>
                    </td>
                  </tr>
                ) : (
                  sessions.map(session => {
                    const wasRedeemed = session.sf_qr_tokens?.[0]?.used_at != null;
                    const userName = getUserName(session.vip_user_id);
                    return (
                      <tr key={session.id}>
                        <td className="sfa-td-muted">{formatDate(session.created_at)}</td>
                        <td>
                          <div className="sfa-user-cell">
                            <span className="sfa-avatar sfa-avatar--indigo">
                              {userName.charAt(0).toUpperCase()}
                            </span>
                            <span className="sfa-user-name">{userName}</span>
                          </div>
                        </td>
                        <td className="sfa-th-center">
                          <span className="sfa-badge sfa-badge--qty">
                            {session.total_items}
                          </span>
                        </td>
                        <td>
                          <span className={`sfa-badge sfa-badge--estado sfa-badge--estado-${session.estado}`}>
                            {session.estado.toUpperCase()}
                          </span>
                        </td>
                        <td>
                          {wasRedeemed ? (
                            <span className="sfa-badge sfa-badge--redeemed">
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12"></polyline>
                              </svg>
                              SÍ
                            </span>
                          ) : (
                            <span className="sfa-badge sfa-badge--pending">
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10"></circle>
                                <polyline points="12 6 12 12 15 15"></polyline>
                              </svg>
                              PENDIENTE
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'usuarios' && (
          <div className="sfa-table-wrap">
            <table className="sfa-table">
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Correo</th>
                  <th>Rol</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr>
                    <td colSpan="3" className="sfa-empty">No hay usuarios registrados</td>
                  </tr>
                ) : (
                  users.map(user => (
                    <tr key={user.user_id}>
                      <td>
                        <div className="sfa-user-cell">
                          <span className="sfa-avatar sfa-avatar--purple">
                            {(user.nombre || 'U').charAt(0).toUpperCase()}
                          </span>
                          <span className="sfa-user-name">{user.nombre || 'Sin nombre'}</span>
                        </div>
                      </td>
                      <td className="sfa-td-muted">{user.correo || '-'}</td>
                      <td>
                        <span className="sfa-badge sfa-badge--rol">
                          {(user.role || 'VIP').toUpperCase()}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

export default AdminDashboard;
