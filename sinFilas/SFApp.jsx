import React, { useState, useEffect } from 'react';
import { useCartStore } from './store/cartStore';
import EscanerBarras from '../DesarrolloSurtido_API/EscanerBarras';
import { SFManualSearch } from './components/SFManualSearch';
import { SFPresentationModal, SFWeightModal } from './components/SFProductModals';
import { SFSedeSelector } from './components/SFSedeSelector';
import { useSFSede } from './hooks/useSFSede';
import { generateGs1Barcode, generateManifestQRValue } from './utils/gs1Utils';
import { searchCatalog, finalizeCheckoutDirect, getUserSessions } from './api/sfApi';
import { QRCodeSVG } from 'qrcode.react';
import './SFApp.css';
import './components/SFButtons.css';

export const SFApp = () => {
  const {
    sedeId,
    sedeName,
    sedes,
    loading: sedeLoading,
    error: sedeError,
    selectSede,
    clearSede,
  } = useSFSede();

  if (sedeLoading || !sedeId) {
    return (
      <SFSedeSelector
        sedes={sedes}
        onSelect={selectSede}
        loading={sedeLoading}
        error={sedeError}
      />
    );
  }

  return <SFAppInner sedeName={sedeName} onChangeSede={clearSede} />;
};

const SFAppInner = ({ sedeName, onChangeSede }) => {
  const [activeTab, setActiveTab] = useState('scanner');
  const [isScanning, setIsScanning] = useState(false);
  const [isProcessingScan, setIsProcessingScan] = useState(false);
  const [scanFeedback, setScanFeedback] = useState('');

  const [selectedProductGroup, setSelectedProductGroup] = useState(null);
  const [selectedPresentation, setSelectedPresentation] = useState(null);

  const [qrRawValue, setQrRawValue] = useState(null);
  const [qrSessionData, setQrSessionData] = useState(null);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [errorFinalizing, setErrorFinalizing] = useState('');

  const [pastSessions, setPastSessions] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const { items, addItem, removeItem, clearCart } = useCartStore();

  useEffect(() => {
    if (activeTab === 'history') {
      const fetchHistory = async () => {
        setLoadingHistory(true);
        try {
          const data = await getUserSessions();
          setPastSessions(data);
        } catch (err) {
          console.error("Error al obtener historial", err);
        } finally {
          setLoadingHistory(false);
        }
      };
      fetchHistory();
    }
  }, [activeTab]);

  const handleScan = async (decodedText) => {
    if (isProcessingScan) return;
    setIsProcessingScan(true);
    setScanFeedback('Buscando...');

    try {
      const results = await searchCatalog(decodedText);
      if (results && results.length > 0) {
        const productGroup = results[0];
        if (productGroup.isGs1 && productGroup.scanned_quantity) {
          const presentation = productGroup.presentaciones.find(p => p.codigo_barras.startsWith('29')) || productGroup.presentaciones[0];
          addItemToCart(productGroup, presentation, productGroup.scanned_quantity, decodedText);
          setScanFeedback(`Agregado: ${productGroup.nombre}`);
        } else {
          if (productGroup.presentaciones.length === 1) {
            handlePresentationChoice(productGroup, productGroup.presentaciones[0]);
          } else {
            setSelectedProductGroup(productGroup);
            setScanFeedback('Selecciona presentación...');
          }
        }
        setTimeout(() => setScanFeedback(''), 2000);
      } else {
        setScanFeedback('Producto no encontrado');
        setTimeout(() => setScanFeedback(''), 3000);
      }
    } catch (err) {
      setScanFeedback('Error de conexión');
      setTimeout(() => setScanFeedback(''), 3000);
    } finally {
      setTimeout(() => setIsProcessingScan(false), 1500);
    }
  };

  const handleProductSelect = (productGroup) => {
    if (productGroup.presentaciones.length === 1) {
      handlePresentationChoice(productGroup, productGroup.presentaciones[0]);
    } else {
      setSelectedProductGroup(productGroup);
    }
  };

  const handlePresentationChoice = (productGroup, presentation) => {
    if (presentation.requiere_peso) {
      setSelectedProductGroup(productGroup);
      setSelectedPresentation(presentation);
    } else {
      addItemToCart(productGroup, presentation, 1, presentation.codigo_barras);
      resetModals();
      setActiveTab('cart');
    }
  };

  const handleWeightSubmit = (weightGrams) => {
    const weightKg = weightGrams / 1000;
    let finalBarcode = selectedPresentation.codigo_barras;
    if (finalBarcode.startsWith('29')) {
      finalBarcode = generateGs1Barcode(finalBarcode, weightKg);
    }
    addItemToCart(selectedProductGroup, selectedPresentation, weightKg, finalBarcode);
    resetModals();
    setActiveTab('cart');
  };

  const addItemToCart = (productGroup, presentation, cantidad, finalBarcode) => {
    addItem({
      f120_id: productGroup.f120_id,
      nombre: productGroup.nombre,
      unidad_medida: presentation.unidad_medida,
      codigo_barras: finalBarcode,
      codigo_base: presentation.codigo_barras,
      requiere_peso: presentation.requiere_peso,
      cantidad: cantidad
    });
  };

  const resetModals = () => {
    setSelectedProductGroup(null);
    setSelectedPresentation(null);
  };

  const handleFinalize = async () => {
    if (items.length === 0) return;
    setIsFinalizing(true);
    setErrorFinalizing('');

    try {
      const finalQrText = generateManifestQRValue(items);
      const data = await finalizeCheckoutDirect(items, finalQrText);

      setQrRawValue(finalQrText);
      const sessionData = {
        id: data.session_id,
        items: [...items],
        date: new Date().toISOString()
      };
      setQrSessionData(sessionData);

      setActiveTab('qr');
      clearCart();
    } catch (error) {
      console.error(error);
      setErrorFinalizing('Ocurrió un error al registrar la sesión. Por favor intenta de nuevo.');
    } finally {
      setIsFinalizing(false);
    }
  };

  return (
    <div className="sf-app-container">
      <div className="sf-app-card">

        <header className="sf-app-header">
          <h1>
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>
            Sin Filas VIP
          </h1>
          <div>
            <span className="sf-badge">
              {items.length} {items.length === 1 ? 'item' : 'items'}
            </span>
          </div>
        </header>

        {sedeName && (
          <div className="sf-sede-bar">
            <span className="sf-sede-bar-label">Sede</span>
            <span className="sf-sede-bar-name">{sedeName}</span>
            <button
              type="button"
              onClick={onChangeSede}
              className="sf-sede-bar-change"
              title="Cambiar de sede"
            >
              Cambiar
            </button>
          </div>
        )}

        {activeTab !== 'qr' && activeTab !== 'history' && (
          <div className="sf-app-tabs">
            <button
              onClick={() => setActiveTab('scanner')}
              className={`sf-tab-btn ${activeTab === 'scanner' ? 'active' : ''}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7V4h3"></path><path d="M4 17v3h3"></path><path d="M20 7V4h-3"></path><path d="M20 17v3h-3"></path><path d="M7 12h10"></path></svg>  
              Escáner
            </button>
            <button
              onClick={() => setActiveTab('manual')}
              className={`sf-tab-btn ${activeTab === 'manual' ? 'active' : ''}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              Buscar
            </button>
            <button
              onClick={() => setActiveTab('cart')}
              className={`sf-tab-btn ${activeTab === 'cart' ? 'active' : ''}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>
              Carrito
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`sf-tab-btn ${activeTab === 'history' ? 'active' : ''}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
              Historial
            </button>
          </div>
        )}

        <div className="sf-app-content">

          {activeTab === 'scanner' && (
            <div className="sf-scanner-tab">
              <button
                onClick={() => setIsScanning(true)}
                className="sf-btn-primary"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7V4h3"></path><path d="M4 17v3h3"></path><path d="M20 7V4h-3"></path><path d="M20 17v3h-3"></path><path d="M7 12h10"></path></svg>
                Escanear código
              </button>
              <p className="sf-scanner-hint">
                Toca el botón para abrir la cámara y escanear un producto.
              </p>
              <div className="sf-feedback-container">
                {scanFeedback && (
                  <div className={`sf-feedback-badge ${scanFeedback.includes('Agregado') ? 'sf-feedback-success' : scanFeedback.includes('no encontrado') || scanFeedback.includes('Error') ? 'sf-feedback-error' : 'sf-feedback-info'}`}>
                    {scanFeedback}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'manual' && (
            <SFManualSearch onProductSelect={handleProductSelect} />
          )}

          {activeTab === 'cart' && (
            <div className="sf-cart-tab">
              {items.length === 0 ? (
                <div className="sf-cart-empty">
                  <div className="sf-cart-empty-icon">🛒</div>
                  <p style={{fontWeight: '600'}}>El carrito está vacío</p>
                  <p>Escanea o busca productos para agregarlos.</p>
                </div>
              ) : (
                <>
                  <ul className="sf-cart-list">
                    {items.map((item, index) => (
                      <li key={`${item.codigo_barras}-${index}`} className="sf-cart-item">
                        <div className="sf-cart-item-info">
                          <p className="sf-cart-item-name">{item.nombre}</p>
                          <p className="sf-cart-item-code">{item.codigo_barras}</p>
                        </div>
                        <div className="sf-cart-item-actions">
                          <span className="sf-cart-qty">
                            {item.cantidad} {item.unidad_medida}
                          </span>
                          <button
                            onClick={() => removeItem(item.codigo_barras)}
                            className="sf-btn-remove"
                            title="Quitar"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>       
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>

                  {errorFinalizing && (
                    <p className="sf-error-msg">{errorFinalizing}</p>
                  )}

                  <div className="sf-cart-footer">
                    <button
                      onClick={handleFinalize}
                      disabled={isFinalizing}
                      className="sf-btn-success"
                    >
                      {isFinalizing ? 'Generando...' : 'Finalizar y Generar QR'}
                    </button>
                    <button
                      onClick={clearCart}
                      disabled={isFinalizing}
                      className="sf-btn-danger-outline"
                    >
                      Vaciar carrito
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'qr' && (
            <div className="sf-qr-tab">
              <h2 className="sf-qr-title">¡Muestra este código a la cajera!</h2>
              <p className="sf-qr-subtitle">
                Este QR contiene todos los productos listos para cobrar.
              </p>

              {qrSessionData && (
                <div className="sf-qr-datetime">
                  <p><strong>Fecha:</strong> {new Date(qrSessionData.date).toLocaleDateString()}</p>
                  <p><strong>Hora:</strong> {new Date(qrSessionData.date).toLocaleTimeString()}</p>
                </div>
              )}

              <div className="sf-qr-box">
                {qrRawValue && (
                  <QRCodeSVG
                    value={qrRawValue}
                    size={280}
                    level={"Q"}
                    includeMargin={true}
                  />
                )}
              </div>

              {qrSessionData && (
                <div className="sf-qr-products">
                  <h3>Resumen de la compra</h3>
                  <ul className="sf-qr-products-list">
                    {qrSessionData.items.map((item, index) => (
                      <li key={index} className="sf-qr-product-item">
                        <span className="sf-qr-qty">{item.cantidad} {item.unidad_medida}</span>
                        <div className="sf-qr-product-info">
                          <span className="sf-qr-name">{item.nombre}</span>
                          <span className="sf-qr-code">{item.codigo_barras}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="sf-qr-footer">
                <button
                  onClick={() => {
                    setQrRawValue(null);
                    setQrSessionData(null);
                    setActiveTab('scanner');
                  }}
                  className="sf-btn-full sf-btn-success"
                >
                  Empezar Nuevo Carrito
                </button>
                <button
                  onClick={() => setActiveTab('history')}
                  className="sf-btn-full sf-btn-secondary"
                  style={{marginTop: '10px'}}
                >
                  Ver sesiones pasadas
                </button>
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div className="sf-history-tab">
              <h2>Historial de Sesiones</h2>
              {loadingHistory ? (
                <p style={{textAlign:'center', marginTop:'20px'}}>Cargando historial...</p>
              ) : pastSessions.length === 0 ? (
                <p style={{textAlign:'center', marginTop:'20px'}}>No hay sesiones pasadas.</p>
              ) : (
                <ul className="sf-history-list">
                  {pastSessions.map(session => (
                    <li key={session.id} className="sf-history-item" onClick={() => {
                       if (session.qrRawValue) {
                         setQrRawValue(session.qrRawValue);
                         setQrSessionData({ items: session.items, date: session.created_at });
                         setActiveTab('qr');
                       }
                    }}>
                      <div className="sf-history-info">
                        <p><strong>Fecha:</strong> {new Date(session.created_at).toLocaleDateString()} {new Date(session.created_at).toLocaleTimeString()}</p>
                        <p><strong>Items:</strong> {session.total_items} | <strong>Estado:</strong> {session.estado}</p>
                      </div>
                      {session.qrRawValue && (
                        <div className="sf-history-action">
                          Ver QR ➔
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <button onClick={() => setActiveTab('scanner')} className="sf-btn-full" style={{marginTop: '20px'}}>Volver al Escáner</button>
            </div>
          )}

        </div>

        {selectedProductGroup && !selectedPresentation && (
          <SFPresentationModal
            product={selectedProductGroup}
            onClose={resetModals}
            onSelect={(pres) => handlePresentationChoice(selectedProductGroup, pres)}
          />
        )}

        {selectedProductGroup && selectedPresentation && (
          <SFWeightModal
            presentation={selectedPresentation}
            productName={selectedProductGroup.nombre}
            onClose={resetModals}
            onSubmit={handleWeightSubmit}
          />
        )}

        <EscanerBarras
          isScanning={isScanning}
          setIsScanning={setIsScanning}
          onScan={handleScan}
        />
      </div>
    </div>
  );
};

export default SFApp;
