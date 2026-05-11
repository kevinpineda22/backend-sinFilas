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

  it('busca por nombre y agrupa por f120_id', async () => {
    supabaseMock.setNextResult({
      data: [
        {
          f120_id: '12345',
          f120_descripcion: 'MANGO TOMMY',
          siesa_codigos_barras: { codigo_barras: '2912345', unidad_medida: 'KL' },
        },
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
