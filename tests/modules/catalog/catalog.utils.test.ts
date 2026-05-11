import { describe, it, expect } from 'vitest';
import { isManualSearchPresentation } from '../../../src/modules/catalog/catalog.utils';

describe('isManualSearchPresentation', () => {
  describe('caso arroz (item 185326)', () => {
    it('acepta 185325UND con unidad UND', () => {
      expect(isManualSearchPresentation('185325UND', 'UND')).toBe(true);
    });

    it('acepta 185325P25 con unidad P25', () => {
      expect(isManualSearchPresentation('185325P25', 'P25')).toBe(true);
    });

    it('rechaza 185325+ (variante con +)', () => {
      expect(isManualSearchPresentation('185325+', 'UND')).toBe(false);
    });

    it('rechaza 185326 pelado (SKU sin sufijo)', () => {
      expect(isManualSearchPresentation('185326', 'UND')).toBe(false);
    });

    it('rechaza 7709138700037 (EAN-13)', () => {
      expect(isManualSearchPresentation('7709138700037', 'UND')).toBe(false);
    });

    it('rechaza M7709138700037 (prefijo M)', () => {
      expect(isManualSearchPresentation('M7709138700037', 'UND')).toBe(false);
    });
  });

  describe('caso cerveza (item 187825)', () => {
    it('acepta 187825UND con unidad UND', () => {
      expect(isManualSearchPresentation('187825UND', 'UND')).toBe(true);
    });

    it('acepta 187825P6 con unidad P6', () => {
      expect(isManualSearchPresentation('187825P6', 'P6')).toBe(true);
    });

    it('rechaza los EAN 7707311662905 y 7707311662929', () => {
      expect(isManualSearchPresentation('7707311662905', 'UND')).toBe(false);
      expect(isManualSearchPresentation('7707311662929', 'UND')).toBe(false);
    });

    it('rechaza M7707311662905 y M7707311662929', () => {
      expect(isManualSearchPresentation('M7707311662905', 'UND')).toBe(false);
      expect(isManualSearchPresentation('M7707311662929', 'UND')).toBe(false);
    });
  });

  describe('GS1 pesables (fruver / carnicería)', () => {
    it('acepta 2912345 (29 + 5 dígitos) como presentación KL', () => {
      expect(isManualSearchPresentation('2912345', 'KL')).toBe(true);
    });

    it('acepta 298765 con LB', () => {
      expect(isManualSearchPresentation('298765', 'LB')).toBe(true);
    });

    it('rechaza 2912345012345 (GS1 con peso embebido, 13 chars) — viene del escáner, no del buscador', () => {
      expect(isManualSearchPresentation('2912345012345', 'KL')).toBe(false);
    });
  });

  describe('caso fruver real (item 5073)', () => {
    // Catálogo SIESA: 0050730050730, 5073+, 50730050730, 61, 5073KL, 2900061
    // El único que sirve para el flujo POS es 2900061 (GS1 corto).

    it('acepta 2900061 con KL (es el único válido para pesables)', () => {
      expect(isManualSearchPresentation('2900061', 'KL')).toBe(true);
    });

    it('rechaza 5073KL aunque termine en KL (es pesable, debe ser GS1 corto)', () => {
      expect(isManualSearchPresentation('5073KL', 'KL')).toBe(false);
    });

    it('rechaza el EAN 0050730050730', () => {
      expect(isManualSearchPresentation('0050730050730', 'KL')).toBe(false);
    });

    it('rechaza 50730050730 (EAN sin el cero inicial)', () => {
      expect(isManualSearchPresentation('50730050730', 'KL')).toBe(false);
    });

    it('rechaza 5073+ (variante con +)', () => {
      expect(isManualSearchPresentation('5073+', 'KL')).toBe(false);
    });

    it('rechaza 61 (código corto local)', () => {
      expect(isManualSearchPresentation('61', 'KL')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('rechaza si código es vacío o null', () => {
      expect(isManualSearchPresentation('', 'UND')).toBe(false);
      expect(isManualSearchPresentation(null, 'UND')).toBe(false);
      expect(isManualSearchPresentation(undefined, 'UND')).toBe(false);
    });

    it('rechaza si unidad es null y el código no es pesable', () => {
      expect(isManualSearchPresentation('185325UND', null)).toBe(false);
    });

    it('rechaza GS1 corto si unidad es null (no sabemos que sea pesable)', () => {
      // Sin unidad_medida no podemos confirmar que sea pesable, así que el
      // filtro lo descarta por seguridad.
      expect(isManualSearchPresentation('2912345', null)).toBe(false);
    });
  });
});
