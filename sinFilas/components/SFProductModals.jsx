import React, { useState } from 'react';
// Force Vite HMR reload
import './SFProductModals.css';
import './SFButtons.css';

export const SFPresentationModal = ({ product, onClose, onSelect }) => {
  return (
    <div className="sf-modal-overlay">
      <div className="sf-modal-content">
        <div className="sf-modal-header">
          <h3 className="sf-modal-title">Seleccionar Presentación</h3>
          <p className="sf-modal-subtitle">{product.nombre}</p>
        </div>
        
        <div className="sf-presentation-list">
          {product.presentaciones.map((pres) => (
            <button
              key={pres.codigo_barras}
              onClick={() => onSelect(pres)}
              className="sf-presentation-btn"
            >
              <div>
                <div className="sf-pres-name">{pres.unidad_medida}</div>
                <div className="sf-pres-code">{pres.codigo_barras}</div>
              </div>
              {pres.requiere_peso && (
                <span className="sf-tag-weight">Pesar</span>
              )}
            </button>
          ))}
        </div>

        <div className="sf-modal-actions">
          <button onClick={onClose} className="sf-btn-cancel">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
};

export const SFWeightModal = ({ presentation, productName, onClose, onSubmit }) => {
  const [weight, setWeight] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    const grams = parseInt(weight, 10);
    if (Number.isFinite(grams) && grams > 0) {
      onSubmit(grams);
    }
  };

  return (
    <div className="sf-modal-overlay">
      <div className="sf-modal-content">
        <div className="sf-modal-header">
          <h3 className="sf-modal-title">Registrar Peso</h3>
          <p className="sf-modal-subtitle">
            {productName} ({presentation.unidad_medida})
          </p>
          <p className="sf-modal-hint">
            Ingresá el peso en gramos. Ej: 1 kilo = 1000, medio kilo = 500.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="sf-input-weight-wrapper">
            <input
              type="number"
              step="1"
              min="1"
              inputMode="numeric"
              placeholder="500"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              className="sf-input-weight"
              autoFocus
              required
            />
            <span className="sf-weight-unit">g</span>
          </div>

          <div className="sf-modal-actions">
            <button type="button" onClick={onClose} className="sf-btn-cancel">
              Cancelar
            </button>
            <button
              type="submit"
              className="sf-btn-success"
              disabled={!weight || parseInt(weight, 10) <= 0}
            >
              Agregar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
