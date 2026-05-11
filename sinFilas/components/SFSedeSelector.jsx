import './SFSedeSelector.css';

export const SFSedeSelector = ({ sedes, onSelect, loading, error }) => {
  return (
    <div className="sf-sede-selector">
      <div className="sf-sede-card">
        <header className="sf-sede-header">
          <h1>Elegí tu sede</h1>
          <p>Las sesiones que crees quedarán asociadas a esta sede.</p>
        </header>

        {loading && <p className="sf-sede-msg">Cargando sedes...</p>}

        {error && !loading && (
          <p className="sf-sede-msg sf-sede-msg--error">
            No pudimos cargar las sedes. Refrescá la página o avisá al admin.
          </p>
        )}

        {!loading && !error && sedes.length === 0 && (
          <p className="sf-sede-msg">No hay sedes activas configuradas.</p>
        )}

        {!loading && !error && sedes.length > 0 && (
          <ul className="sf-sede-list">
            {sedes.map((sede) => (
              <li key={sede.id}>
                <button
                  type="button"
                  className="sf-sede-btn"
                  onClick={() => onSelect(sede)}
                >
                  <span className="sf-sede-btn-name">{sede.nombre}</span>
                  {sede.slug && <span className="sf-sede-btn-slug">{sede.slug}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default SFSedeSelector;
