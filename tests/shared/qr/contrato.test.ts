/**
 * Corre la tabla de casos compartida contra la implementación de ESTE repo.
 * El frontend corre la misma tabla contra la suya
 * (`Pagina-web_React` → `src/shared/qr/contratoBackend.test.js`).
 *
 * Si una regla cambia de un solo lado, este test falla acá o allá.
 */

import { describe, it, expect } from 'vitest';
import {
  esCodigoUsable,
  esGs1Pesable,
  esPrefijoGs1Valido,
  esUnidadPesable,
  gs1TieneCheckValido,
  limpiarCodigo,
  variantesParaBuscar,
} from '../../../src/shared/qr/codigos';
import {
  CASOS_CHECK_GS1,
  CASOS_CODIGO,
  CASOS_PREFIJO_GS1,
  CASOS_UNIDAD_PESABLE,
} from './casosContrato';

describe('contrato de códigos: limpieza', () => {
  it.each(CASOS_CODIGO)('limpiarCodigo(%o)', ({ entrada, limpio }) => {
    expect(limpiarCodigo(entrada)).toBe(limpio);
  });
});

describe('contrato de códigos: usable', () => {
  it.each(CASOS_CODIGO)('esCodigoUsable(%o)', ({ entrada, usable }) => {
    expect(esCodigoUsable(limpiarCodigo(entrada))).toBe(usable);
  });
});

describe('contrato de códigos: GS1 de peso variable', () => {
  it.each(CASOS_CODIGO)('esGs1Pesable(%o)', ({ entrada, gs1 }) => {
    expect(esGs1Pesable(limpiarCodigo(entrada))).toBe(gs1);
  });

  it.each(CASOS_CHECK_GS1)('gs1TieneCheckValido(%o)', ({ codigo, valido }) => {
    expect(gs1TieneCheckValido(codigo)).toBe(valido);
  });

  it.each(CASOS_PREFIJO_GS1)('esPrefijoGs1Valido(%o)', ({ prefijo, valido }) => {
    expect(esPrefijoGs1Valido(prefijo)).toBe(valido);
  });
});

describe('contrato de unidades pesables', () => {
  it.each(CASOS_UNIDAD_PESABLE)('esUnidadPesable(%o)', ({ um, pesable }) => {
    expect(esUnidadPesable(um)).toBe(pesable);
  });
});

describe('variantes de búsqueda en siesa_codigos_barras', () => {
  it('busca la forma limpia y las internas de SIESA', () => {
    // La tabla guarda `185325+` y `M7702…`. Buscar solo la forma física daría
    // "no existe" sobre un código perfectamente real.
    expect(variantesParaBuscar('185325')).toEqual([
      '185325',
      '185325+',
      'M185325',
      'N185325',
    ]);
  });

  it('parte de la forma limpia, venga como venga', () => {
    expect(variantesParaBuscar('M185325+')).toEqual(variantesParaBuscar('185325'));
  });

  it('no busca nada si no hay código', () => {
    expect(variantesParaBuscar('')).toEqual([]);
    expect(variantesParaBuscar(null)).toEqual([]);
  });
});
