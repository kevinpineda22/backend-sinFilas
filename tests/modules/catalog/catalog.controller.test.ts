import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { MockedSupabase } from '../../helpers/supabaseMock';

vi.mock('../../../src/shared/db/supabaseClient', async () => {
  const { createSupabaseMock } = await import('../../helpers/supabaseMock');
  return { supabaseAdmin: createSupabaseMock() };
});

// Imports DESPUÉS del vi.mock
import { supabaseAdmin } from '../../../src/shared/db/supabaseClient';
import app from '../../../src/app';

const supabaseMock = supabaseAdmin as unknown as MockedSupabase;

describe('GET /api/sf/catalog/search', () => {
  beforeEach(() => {
    supabaseMock.reset();
  });

  it('retorna 400 si falta query', async () => {
    const res = await request(app).get('/api/sf/catalog/search');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation-error');
  });

  it('retorna 400 si query es muy corta', async () => {
    const res = await request(app).get('/api/sf/catalog/search').query({ query: 'a' });
    expect(res.status).toBe(400);
  });

  it('busca por nombre y agrupa por f120_id (solo presentaciones útiles)', async () => {
    supabaseMock.setNextResult({
      data: [
        // GS1 pesable corto: válido para selección manual
        {
          f120_id: '12345',
          f120_descripcion: 'MANGO TOMMY',
          siesa_codigos_barras: { codigo_barras: '2912345', unidad_medida: 'KL' },
        },
        // Sufijo UND: válido para selección manual
        {
          f120_id: '12345',
          f120_descripcion: 'MANGO TOMMY',
          siesa_codigos_barras: { codigo_barras: '12345UND', unidad_medida: 'UND' },
        },
        // EAN puro: debe filtrarse
        {
          f120_id: '12345',
          f120_descripcion: 'MANGO TOMMY',
          siesa_codigos_barras: { codigo_barras: '7700001234567', unidad_medida: 'UND' },
        },
      ],
      error: null,
    });

    const res = await request(app).get('/api/sf/catalog/search').query({ query: 'mango' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].f120_id).toBe('12345');
    expect(res.body[0].nombre).toBe('MANGO TOMMY');
    expect(res.body[0].presentaciones).toHaveLength(2);
    expect(res.body[0].presentaciones.find((p: any) => p.unidad_medida === 'KL').requiere_peso).toBe(
      true,
    );
    expect(res.body[0].presentaciones.find((p: any) => p.unidad_medida === 'UND').requiere_peso).toBe(
      false,
    );
    // El EAN puro 7700001234567 quedó filtrado
    expect(
      res.body[0].presentaciones.find((p: any) => p.codigo_barras === '7700001234567'),
    ).toBeUndefined();
  });

  it('detecta GS1 (prefijo 29, 13 chars) y devuelve scanned_quantity', async () => {
    supabaseMock.setNextResult({
      data: [
        {
          f120_id: '98765',
          f120_descripcion: 'CARNE RES',
          siesa_codigos_barras: { codigo_barras: '2998765', unidad_medida: 'KL' },
        },
      ],
      error: null,
    });

    const res = await request(app).get('/api/sf/catalog/search').query({ query: '2998765012345' });

    expect(res.status).toBe(200);
    expect(res.body[0].isGs1).toBe(true);
    expect(res.body[0].scanned_quantity).toBeCloseTo(1.234, 3);
  });

  it('búsqueda por texto: filtra códigos basura del arroz (caso real)', async () => {
    // Simulo la respuesta cruda de Supabase para el item 185326 ARROZ CONGO
    // con las 6 variantes que existen en BD.
    const skuId = '185326';
    const nombre = 'ARROZ CONGO 500G';
    supabaseMock.setNextResult({
      data: [
        { f120_id: skuId, f120_descripcion: nombre, siesa_codigos_barras: { codigo_barras: '185325+', unidad_medida: 'UND' } },
        { f120_id: skuId, f120_descripcion: nombre, siesa_codigos_barras: { codigo_barras: '185326', unidad_medida: 'UND' } },
        { f120_id: skuId, f120_descripcion: nombre, siesa_codigos_barras: { codigo_barras: '7709138700037', unidad_medida: 'UND' } },
        { f120_id: skuId, f120_descripcion: nombre, siesa_codigos_barras: { codigo_barras: 'M7709138700037', unidad_medida: 'UND' } },
        { f120_id: skuId, f120_descripcion: nombre, siesa_codigos_barras: { codigo_barras: '185325P25', unidad_medida: 'P25' } },
        { f120_id: skuId, f120_descripcion: nombre, siesa_codigos_barras: { codigo_barras: '185325UND', unidad_medida: 'UND' } },
      ],
      error: null,
    });

    const res = await request(app).get('/api/sf/catalog/search').query({ query: 'arroz' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const codes = res.body[0].presentaciones.map((p: any) => p.codigo_barras).sort();
    expect(codes).toEqual(['185325P25', '185325UND']);
  });

  it('búsqueda por texto: filtra códigos basura de la cerveza (caso real)', async () => {
    const skuId = '187825';
    const nombre = 'CERVEZA AGUILA LATA';
    supabaseMock.setNextResult({
      data: [
        { f120_id: skuId, f120_descripcion: nombre, siesa_codigos_barras: { codigo_barras: '187825+', unidad_medida: 'UND' } },
        { f120_id: skuId, f120_descripcion: nombre, siesa_codigos_barras: { codigo_barras: '7707311662905', unidad_medida: 'UND' } },
        { f120_id: skuId, f120_descripcion: nombre, siesa_codigos_barras: { codigo_barras: '7707311662929', unidad_medida: 'P6' } },
        { f120_id: skuId, f120_descripcion: nombre, siesa_codigos_barras: { codigo_barras: 'M7707311662905', unidad_medida: 'UND' } },
        { f120_id: skuId, f120_descripcion: nombre, siesa_codigos_barras: { codigo_barras: 'M7707311662929', unidad_medida: 'P6' } },
        { f120_id: skuId, f120_descripcion: nombre, siesa_codigos_barras: { codigo_barras: '187825P6', unidad_medida: 'P6' } },
        { f120_id: skuId, f120_descripcion: nombre, siesa_codigos_barras: { codigo_barras: '187825UND', unidad_medida: 'UND' } },
      ],
      error: null,
    });

    const res = await request(app).get('/api/sf/catalog/search').query({ query: 'cerveza' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const codes = res.body[0].presentaciones.map((p: any) => p.codigo_barras).sort();
    expect(codes).toEqual(['187825P6', '187825UND']);
  });

  it('búsqueda por texto: caso fruver real (item 5073) deja solo el GS1 corto', async () => {
    // Catálogo SIESA real: 0050730050730, 5073+, 50730050730, 61, 5073KL, 2900061
    const skuId = '5073';
    const nombre = 'PAPAYA';
    supabaseMock.setNextResult({
      data: [
        { f120_id: skuId, f120_descripcion: nombre, siesa_codigos_barras: { codigo_barras: '0050730050730', unidad_medida: 'KL' } },
        { f120_id: skuId, f120_descripcion: nombre, siesa_codigos_barras: { codigo_barras: '5073+', unidad_medida: 'KL' } },
        { f120_id: skuId, f120_descripcion: nombre, siesa_codigos_barras: { codigo_barras: '50730050730', unidad_medida: 'KL' } },
        { f120_id: skuId, f120_descripcion: nombre, siesa_codigos_barras: { codigo_barras: '61', unidad_medida: 'KL' } },
        { f120_id: skuId, f120_descripcion: nombre, siesa_codigos_barras: { codigo_barras: '5073KL', unidad_medida: 'KL' } },
        { f120_id: skuId, f120_descripcion: nombre, siesa_codigos_barras: { codigo_barras: '2900061', unidad_medida: 'KL' } },
      ],
      error: null,
    });

    const res = await request(app).get('/api/sf/catalog/search').query({ query: 'papaya' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].presentaciones).toHaveLength(1);
    expect(res.body[0].presentaciones[0]).toEqual({
      codigo_barras: '2900061',
      unidad_medida: 'KL',
      requiere_peso: true,
    });
  });

  it('búsqueda por texto: descarta productos que quedaron sin presentaciones útiles', async () => {
    // Producto que solo tiene EAN y prefijo M (nada útil para selección manual).
    supabaseMock.setNextResult({
      data: [
        { f120_id: '999', f120_descripcion: 'BASURA', siesa_codigos_barras: { codigo_barras: '7700000000001', unidad_medida: 'UND' } },
        { f120_id: '999', f120_descripcion: 'BASURA', siesa_codigos_barras: { codigo_barras: 'M7700000000001', unidad_medida: 'UND' } },
      ],
      error: null,
    });

    const res = await request(app).get('/api/sf/catalog/search').query({ query: 'basura' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('búsqueda NUMÉRICA (tipeo de código): NO aplica el filtro', async () => {
    // Cuando alguien tipea o escanea un código exacto, devolvemos todas las
    // presentaciones para que el frontend pueda hacer match.
    supabaseMock.setNextResult({
      data: [
        { f120_id: '185326', f120_descripcion: 'ARROZ', siesa_codigos_barras: { codigo_barras: '7709138700037', unidad_medida: 'UND' } },
      ],
      error: null,
    });

    const res = await request(app).get('/api/sf/catalog/search').query({ query: '7709138700037' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].presentaciones).toHaveLength(1);
    expect(res.body[0].presentaciones[0].codigo_barras).toBe('7709138700037');
  });

  it('propaga 500 si Supabase devuelve error', async () => {
    supabaseMock.setNextResult({
      data: null,
      error: { message: 'connection refused' },
    });

    const res = await request(app).get('/api/sf/catalog/search').query({ query: 'mango' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});
