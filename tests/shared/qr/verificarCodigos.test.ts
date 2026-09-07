import { describe, it, expect } from 'vitest';
import {
  codigosABuscar,
  evaluarItems,
} from '../../../src/shared/qr/verificarCodigos';
import { MOTIVO } from '../../../src/shared/qr/codigos';

const item = (extra: Record<string, unknown> = {}) => ({
  codigo_barras: '7702001012345',
  nombre: 'ARROZ DIANA',
  unidad_medida: 'UND',
  ...extra,
});

// Naranja: SIESA guarda el prefijo 2900061 (NO 29 + f120_id 5073).
const GS1_NARANJA = '2900061012500';

describe('codigosABuscar', () => {
  it('de un código normal busca sus variantes internas', () => {
    // La tabla guarda `185325+` y `M7702…`: buscar solo la forma física daría
    // "no existe" sobre un código real.
    expect(codigosABuscar([item({ codigo_barras: '185325UND' })])).toEqual([
      '185325UND',
      '185325UND+',
      'M185325UND',
      'N185325UND',
    ]);
  });

  it('de un GS1 pesable busca el PREFIJO, no el código', () => {
    // El GS1 lleva el peso adentro: cada etiqueta es un código distinto y
    // ninguno existe como fila. Lo que sí existe es el prefijo de 7 dígitos.
    expect(codigosABuscar([item({ codigo_barras: GS1_NARANJA })])).toEqual([
      '2900061',
      '2900061+',
      'M2900061',
      'N2900061',
    ]);
  });

  it('no busca nada por un ítem sin código', () => {
    expect(codigosABuscar([item({ codigo_barras: '' })])).toEqual([]);
    expect(codigosABuscar([item({ codigo_barras: 'N/A' })])).toEqual([]);
  });

  it('no repite búsquedas del mismo código', () => {
    const codigos = codigosABuscar([item(), item(), item()]);
    expect(codigos).toHaveLength(4);
  });
});

describe('evaluarItems', () => {
  const existentes = new Set(['7702001012345', '2900061']);

  it('no reporta nada cuando todo existe', () => {
    expect(evaluarItems([item()], existentes)).toEqual([]);
  });

  it('acepta el código guardado con marcadores internos', () => {
    // El ítem llega en forma física y la tabla lo tiene con `+` o `M`. Los dos
    // lados comparan la forma limpia.
    expect(evaluarItems([item({ codigo_barras: 'M7702001012345' })], existentes)).toEqual([]);
    expect(evaluarItems([item({ codigo_barras: '7702001012345+' })], existentes)).toEqual([]);
  });

  it('reporta NO_REGISTRADO el código que no está en la tabla', () => {
    const [problema] = evaluarItems([item({ codigo_barras: '7799999999999' })], existentes);
    expect(problema.motivo).toBe(MOTIVO.NO_REGISTRADO);
    expect(problema.nombre).toBe('ARROZ DIANA');
    // Se devuelve el código TAL COMO LLEGÓ: quien lo lea tiene que poder
    // buscarlo en el maestro con la forma que se mandó.
    expect(problema.codigo_barras).toBe('7799999999999');
  });

  it('reporta SIN_CODIGO el ítem sin código utilizable', () => {
    expect(evaluarItems([item({ codigo_barras: '' })], existentes)[0].motivo).toBe(
      MOTIVO.SIN_CODIGO,
    );
    expect(evaluarItems([item({ codigo_barras: 'N/A' })], existentes)[0].motivo).toBe(
      MOTIVO.SIN_CODIGO,
    );
  });

  describe('etiquetas de báscula', () => {
    it('acepta el GS1 con check bueno y prefijo real', () => {
      expect(evaluarItems([item({ codigo_barras: GS1_NARANJA })], existentes)).toEqual([]);
    });

    it('reporta el GS1 con el dígito verificador cambiado', () => {
      // La caja calcula el mismo dígito y descarta la lectura: esa línea se
      // pierde en silencio si nadie avisa.
      const [p] = evaluarItems([item({ codigo_barras: '2900061012501' })], existentes);
      expect(p.motivo).toBe(MOTIVO.GS1_INVALIDO);
    });

    it('reporta el GS1 armado sobre un prefijo que NO existe', () => {
      // 2950730 = "29 + f120_id", el prefijo deducido. SIESA guarda 2900061.
      const [p] = evaluarItems([item({ codigo_barras: '2950730012508' })], existentes);
      expect(p.motivo).toBe(MOTIVO.GS1_INVALIDO);
    });
  });

  it('evalúa cada ítem por separado y devuelve todos los problemas', () => {
    const problemas = evaluarItems(
      [
        item(),
        item({ codigo_barras: '', nombre: 'SIN CODIGO' }),
        item({ codigo_barras: '7799999999999', nombre: 'FANTASMA' }),
      ],
      existentes,
    );
    expect(problemas.map((p) => [p.nombre, p.motivo])).toEqual([
      ['SIN CODIGO', MOTIVO.SIN_CODIGO],
      ['FANTASMA', MOTIVO.NO_REGISTRADO],
    ]);
  });

  it('tolera un carrito vacío o mal formado', () => {
    expect(evaluarItems([], existentes)).toEqual([]);
    expect(evaluarItems(null as never, existentes)).toEqual([]);
  });
});
