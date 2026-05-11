import React, { useState } from 'react';
import { searchCatalog } from '../api/sfApi';
import './SFManualSearch.css';

export const SFManualSearch = ({ onProductSelect }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = async (e) => {
    const searchQuery = e.target.value;
    setQuery(searchQuery);

    if (searchQuery.length < 3) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    setIsSearching(true);
    try {
      const data = await searchCatalog(searchQuery);
      setResults(data);
      setHasSearched(true);
    } catch (error) {
      console.error(error);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="sf-search-container">
      <div className="sf-search-header">
        <div className="sf-search-input-wrapper">
          <span className="sf-search-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          </span>
          <input
            type="text"
            placeholder="Buscar por nombre, SKU o código..."
            value={query}
            onChange={handleSearch}
            className="sf-search-input"
            autoFocus
          />
        </div>
      </div>
      
      {isSearching && (
        <div className="sf-search-loading">
          <p>Buscando productos...</p>
        </div>
      )}

      {!isSearching && results.length > 0 && (
        <ul className="sf-search-results">
          {results.map((product) => (
            <li 
              key={product.f120_id}
              onClick={() => onProductSelect(product)}
              className="sf-search-item"
            >
              <span className="sf-search-item-name">{product.nombre}</span>
              <span className="sf-search-item-meta">
                <span className="sf-search-sku">SKU: {product.f120_id}</span>
                <span className="sf-search-pres">{product.presentaciones.length} presentacion(es)</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {!isSearching && hasSearched && results.length === 0 && (
        <div className="sf-search-empty">
          <span style={{fontSize: '2.5rem', marginBottom: '0.75rem', opacity: 0.5}}>📦</span>
          <p>No se encontraron productos con "{query}"</p>
        </div>
      )}
    </div>
  );
};
