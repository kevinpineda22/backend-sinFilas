import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { MockedSupabase } from '../../helpers/supabaseMock';

vi.mock('../../../src/shared/db/supabaseClient', async () => {
  const { createSupabaseMock } = await import('../../helpers/supabaseMock');
  return { supabaseAdmin: createSupabaseMock() };
});

import { supabaseAdmin } from '../../../src/shared/db/supabaseClient';
import app from '../../../src/app';

const supabaseMock = supabaseAdmin as unknown as MockedSupabase;

const SESSION_UUID = '550e8400-e29b-41d4-a716-446655440000';

describe('POST /api/sf/sessions/:id/redeem', () => {
  beforeEach(() => {
    supabaseMock.reset();
  });

  it('retorna 400 si :id no es UUID', async () => {
    const res = await request(app).post('/api/sf/sessions/not-uuid/redeem');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation-error');
  });

  it('retorna 404 si la sesión no existe', async () => {
    supabaseMock.setNextResult({ data: null, error: { message: 'no rows' } });

    const res = await request(app).post(`/api/sf/sessions/${SESSION_UUID}/redeem`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('session-not-found');
  });

  it('retorna 409 si la sesión ya fue cobrada', async () => {
    supabaseMock.setNextResult({
      data: { id: SESSION_UUID, estado: 'cobrado' },
      error: null,
    });

    const res = await request(app).post(`/api/sf/sessions/${SESSION_UUID}/redeem`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('session-already-redeemed');
  });

  it('retorna 409 si la sesión fue cancelada', async () => {
    supabaseMock.setNextResult({
      data: { id: SESSION_UUID, estado: 'cancelado' },
      error: null,
    });

    const res = await request(app).post(`/api/sf/sessions/${SESSION_UUID}/redeem`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('session-cancelled');
  });

  it('happy path: marca tokens como usados y sesión como cobrado', async () => {
    supabaseMock.setNextResults([
      { data: { id: SESSION_UUID, estado: 'finalizado' }, error: null }, // SELECT sf_sessions
      { data: null, error: null }, // UPDATE sf_qr_tokens
      { data: null, error: null }, // UPDATE sf_sessions
      { data: null, error: null }, // INSERT sf_audit_log
    ]);

    const res = await request(app).post(`/api/sf/sessions/${SESSION_UUID}/redeem`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.session_id).toBe(SESSION_UUID);
    expect(typeof res.body.redeemed_at).toBe('string');

    // Verifico que se hayan tocado las 3 tablas:
    const fromTables = supabaseMock.calls
      .filter((c) => c.method === 'from')
      .map((c) => c.args[0]);
    expect(fromTables).toContain('sf_sessions');
    expect(fromTables).toContain('sf_qr_tokens');
    expect(fromTables).toContain('sf_audit_log');

    // Verifico que sf_qr_tokens tuvo un update con used_at no-null
    const updateCalls = supabaseMock.calls.filter((c) => c.method === 'update');
    const tokenUpdate = updateCalls.find(
      (c) => (c.args[0] as Record<string, unknown>).used_at !== undefined,
    );
    expect(tokenUpdate).toBeDefined();
    expect((tokenUpdate!.args[0] as Record<string, unknown>).used_at).toBeTruthy();

    // Verifico que sf_sessions se actualizó a 'cobrado'
    const sessionUpdate = updateCalls.find(
      (c) => (c.args[0] as Record<string, unknown>).estado === 'cobrado',
    );
    expect(sessionUpdate).toBeDefined();
  });

  it('retorna 500 si falla el update del token', async () => {
    supabaseMock.setNextResults([
      { data: { id: SESSION_UUID, estado: 'finalizado' }, error: null },
      { data: null, error: { message: 'tokens update failed' } },
    ]);

    const res = await request(app).post(`/api/sf/sessions/${SESSION_UUID}/redeem`);
    expect(res.status).toBe(500);
  });
});
