import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { MockedSupabase } from '../../helpers/supabaseMock';

vi.mock('../../../src/shared/db/supabaseClient', async () => {
  const { createSupabaseMock } = await import('../../helpers/supabaseMock');
  return { supabaseAdmin: createSupabaseMock() };
});

import { supabaseAdmin } from '../../../src/shared/db/supabaseClient';
import app from '../../../src/app';

const supabaseMock = supabaseAdmin as unknown as MockedSupabase;

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET as string;
const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const VIP_USER_ID = 'aa11bb22-cc33-4444-bb55-cc66dd77ee88';

const validItem = {
  codigo_barras: '7700001234567',
  nombre: 'ARROZ 500G',
  cantidad: 1,
  unidad_medida: 'UND',
};

const buildToken = (sub = VIP_USER_ID, extras: Record<string, unknown> = {}) =>
  jwt.sign({ sub, email: 'vip@merkahorrosas.com', role: 'sf_vip', ...extras }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });

const authedRequest = () =>
  request(app)
    .post('/api/sf/sessions/checkout-direct')
    .set('Authorization', `Bearer ${buildToken()}`)
    .set('X-Sede-ID', VALID_UUID);

describe('POST /api/sf/sessions/checkout-direct (con auth y sede)', () => {
  beforeEach(() => {
    supabaseMock.reset();
  });

  // ---------- Auth ----------
  it('retorna 401 si no hay Authorization', async () => {
    const res = await request(app)
      .post('/api/sf/sessions/checkout-direct')
      .set('X-Sede-ID', VALID_UUID)
      .send({ items: [validItem] });
    expect(res.status).toBe(401);
  });

  it('retorna 401 si el token es inválido', async () => {
    const res = await request(app)
      .post('/api/sf/sessions/checkout-direct')
      .set('Authorization', 'Bearer token.basura')
      .set('X-Sede-ID', VALID_UUID)
      .send({ items: [validItem] });
    expect(res.status).toBe(401);
  });

  // ---------- Sede ----------
  it('retorna 400 si falta X-Sede-ID', async () => {
    const res = await request(app)
      .post('/api/sf/sessions/checkout-direct')
      .set('Authorization', `Bearer ${buildToken()}`)
      .send({ items: [validItem] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing-sede-id');
  });

  it('retorna 400 si X-Sede-ID no es UUID', async () => {
    const res = await request(app)
      .post('/api/sf/sessions/checkout-direct')
      .set('Authorization', `Bearer ${buildToken()}`)
      .set('X-Sede-ID', 'todas')
      .send({ items: [validItem] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid-sede-id');
  });

  // ---------- Validación del body ----------
  it('retorna 400 si items está vacío', async () => {
    const res = await authedRequest().send({ items: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation-error');
  });

  it('retorna 400 si falta items', async () => {
    const res = await authedRequest().send({});
    expect(res.status).toBe(400);
  });

  it('retorna 400 si cantidad es 0', async () => {
    const res = await authedRequest().send({ items: [{ ...validItem, cantidad: 0 }] });
    expect(res.status).toBe(400);
  });

  // ---------- Happy path ----------
  it('crea sesión usando req.user.id y req.sedeId (no UUID cero)', async () => {
    supabaseMock.setNextResults([
      { data: { id: 'session-uuid-1' }, error: null }, // INSERT sf_sessions .select().single()
      { data: null, error: null }, // INSERT sf_session_items
      { data: null, error: null }, // INSERT sf_qr_tokens
      { data: null, error: null }, // INSERT sf_audit_log session.finalized
      { data: null, error: null }, // INSERT sf_audit_log qr.generated
    ]);

    const res = await authedRequest().send({ items: [validItem] });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ session_id: 'session-uuid-1', success: true });

    const sessionInsertCall = supabaseMock.calls.find((c) => c.method === 'insert');
    expect(sessionInsertCall).toBeDefined();
    const insertedRow = sessionInsertCall!.args[0] as Record<string, unknown>;
    expect(insertedRow.vip_user_id).toBe(VIP_USER_ID);
    expect(insertedRow.sede_id).toBe(VALID_UUID);
    expect(insertedRow.estado).toBe('finalizado');
    expect(insertedRow.total_items).toBe(1);
  });

  // ---------- Errores Supabase ----------
  it('retorna 500 si falla la inserción de la sesión (sin rollback porque no hay nada que borrar)', async () => {
    supabaseMock.setNextResult({
      data: null,
      error: { message: 'duplicate key violation' },
    });

    const res = await authedRequest().send({ items: [validItem] });
    expect(res.status).toBe(500);

    // No debería haberse llamado delete (no hubo session insertada)
    expect(supabaseMock.calls.find((c) => c.method === 'delete')).toBeUndefined();
  });

  it('retorna 500 y hace rollback si falla la inserción de items', async () => {
    supabaseMock.setNextResults([
      { data: { id: 'session-rollback-1' }, error: null }, // INSERT sf_sessions
      { data: null, error: { message: 'items error' } }, // INSERT sf_session_items falla
      { data: null, error: null }, // DELETE de la sesión
      { data: null, error: null }, // INSERT sf_audit_log session.rollback
    ]);

    const res = await authedRequest().send({ items: [validItem] });
    expect(res.status).toBe(500);

    // Verificamos que se llamó delete + eq(id, session-rollback-1)
    const deleteCall = supabaseMock.calls.find((c) => c.method === 'delete');
    expect(deleteCall).toBeDefined();

    const eqCalls = supabaseMock.calls.filter((c) => c.method === 'eq');
    const sessionEq = eqCalls.find((c) => c.args[0] === 'id' && c.args[1] === 'session-rollback-1');
    expect(sessionEq).toBeDefined();
  });

  it('retorna 500 y hace rollback si falla la inserción del token QR', async () => {
    supabaseMock.setNextResults([
      { data: { id: 'session-rollback-2' }, error: null }, // INSERT sf_sessions
      { data: null, error: null }, // INSERT sf_session_items OK
      { data: null, error: { message: 'token error' } }, // INSERT sf_qr_tokens falla
      { data: null, error: null }, // DELETE de la sesión
      { data: null, error: null }, // INSERT sf_audit_log session.rollback
    ]);

    const res = await authedRequest().send({ items: [validItem] });
    expect(res.status).toBe(500);

    const deleteCall = supabaseMock.calls.find((c) => c.method === 'delete');
    expect(deleteCall).toBeDefined();

    const eqCalls = supabaseMock.calls.filter((c) => c.method === 'eq');
    const sessionEq = eqCalls.find((c) => c.args[0] === 'id' && c.args[1] === 'session-rollback-2');
    expect(sessionEq).toBeDefined();
  });

  it('happy path NO llama delete (sin rollback necesario)', async () => {
    supabaseMock.setNextResults([
      { data: { id: 'session-happy' }, error: null }, // INSERT sf_sessions
      { data: null, error: null }, // INSERT sf_session_items
      { data: null, error: null }, // INSERT sf_qr_tokens
      { data: null, error: null }, // INSERT sf_audit_log session.finalized
      { data: null, error: null }, // INSERT sf_audit_log qr.generated
    ]);

    const res = await authedRequest().send({ items: [validItem] });
    expect(res.status).toBe(201);
    expect(supabaseMock.calls.find((c) => c.method === 'delete')).toBeUndefined();
  });

  it('happy path escribe sf_audit_log con session.finalized y qr.generated', async () => {
    supabaseMock.setNextResults([
      { data: { id: 'session-audit' }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: null, error: null },
    ]);

    const res = await authedRequest().send({ items: [validItem] });
    expect(res.status).toBe(201);

    // Buscamos los inserts en sf_audit_log mirando `from('sf_audit_log')`
    const auditFromCalls = supabaseMock.calls.filter(
      (c) => c.method === 'from' && c.args[0] === 'sf_audit_log',
    );
    expect(auditFromCalls.length).toBeGreaterThanOrEqual(2);
  });
});
