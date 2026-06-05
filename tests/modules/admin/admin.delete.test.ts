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
const SESSION_ID = '550e8400-e29b-41d4-a716-446655440000';
const ADMIN_ID = 'aa11bb22-cc33-4444-bb55-cc66dd77ee88';

const token = jwt.sign({ sub: ADMIN_ID, email: 'admin@merkahorrosas.com', role: 'sf_admin' }, JWT_SECRET, {
  algorithm: 'HS256',
  expiresIn: '1h',
});

const del = (id: string) =>
  request(app).delete(`/api/sf/admin/sessions/${id}`).set('Authorization', `Bearer ${token}`);

describe('DELETE /api/sf/admin/sessions/:id', () => {
  beforeEach(() => {
    supabaseMock.reset();
  });

  it('retorna 401 sin token', async () => {
    const res = await request(app).delete(`/api/sf/admin/sessions/${SESSION_ID}`);
    expect(res.status).toBe(401);
  });

  it('retorna 400 si el id no es UUID', async () => {
    const res = await del('no-es-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation-error');
  });

  it('retorna 404 si la sesión no existe', async () => {
    supabaseMock.setNextResults([
      { data: null, error: null }, // SELECT existencia .single() → no existe
    ]);
    const res = await del(SESSION_ID);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('session-not-found');
    // No debe intentar borrar si no existe.
    expect(supabaseMock.calls.find((c) => c.method === 'delete')).toBeUndefined();
  });

  it('borra la sesión existente y registra audit log', async () => {
    supabaseMock.setNextResults([
      { data: { id: SESSION_ID, total_items: 3, total_precio: 12000, vip_user_id: 'vip-1' }, error: null }, // SELECT
      { data: null, error: null }, // DELETE
      { data: null, error: null }, // INSERT audit
    ]);

    const res = await del(SESSION_ID);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, id: SESSION_ID });

    const deleteCall = supabaseMock.calls.find((c) => c.method === 'delete');
    expect(deleteCall).toBeDefined();

    const auditInsert = supabaseMock.calls.find(
      (c) => c.method === 'insert',
    );
    expect(auditInsert).toBeDefined();
    const auditRow = auditInsert!.args[0] as Record<string, unknown>;
    expect(auditRow.action).toBe('session.deleted');
    // No referenciamos la sesión borrada en session_id (FK ya no existe).
    expect(auditRow.session_id).toBeNull();
    expect((auditRow.details as Record<string, unknown>).deleted_session_id).toBe(SESSION_ID);
  });
});
