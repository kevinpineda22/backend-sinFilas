import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MockedSupabase } from '../../helpers/supabaseMock';

vi.mock('../../../src/shared/db/supabaseClient', async () => {
  const { createSupabaseMock } = await import('../../helpers/supabaseMock');
  return { supabaseAdmin: createSupabaseMock() };
});

import { supabaseAdmin } from '../../../src/shared/db/supabaseClient';
import { logAudit } from '../../../src/shared/audit/auditWriter';

const supabaseMock = supabaseAdmin as unknown as MockedSupabase;

describe('logAudit', () => {
  beforeEach(() => {
    supabaseMock.reset();
  });

  it('inserta una fila en sf_audit_log con action, session_id, user_id y details', async () => {
    supabaseMock.setNextResult({ data: null, error: null });

    await logAudit({
      action: 'session.finalized',
      sessionId: 'session-x',
      userId: 'user-x',
      details: { foo: 'bar' },
    });

    const fromCall = supabaseMock.calls.find(
      (c) => c.method === 'from' && c.args[0] === 'sf_audit_log',
    );
    expect(fromCall).toBeDefined();

    const insertCall = supabaseMock.calls.find((c) => c.method === 'insert');
    expect(insertCall).toBeDefined();

    const row = insertCall!.args[0] as Record<string, unknown>;
    expect(row).toEqual({
      session_id: 'session-x',
      user_id: 'user-x',
      action: 'session.finalized',
      details: { foo: 'bar' },
    });
  });

  it('usa null para sessionId/userId si no se pasan', async () => {
    supabaseMock.setNextResult({ data: null, error: null });

    await logAudit({ action: 'qr.redeemed' });

    const insertCall = supabaseMock.calls.find((c) => c.method === 'insert');
    expect(insertCall).toBeDefined();
    const row = insertCall!.args[0] as Record<string, unknown>;
    expect(row.session_id).toBeNull();
    expect(row.user_id).toBeNull();
    expect(row.details).toEqual({});
  });

  it('NO lanza si Supabase devuelve error (fire-and-forget)', async () => {
    supabaseMock.setNextResult({ data: null, error: { message: 'audit insert failed' } });

    await expect(
      logAudit({ action: 'session.finalized', sessionId: 's', userId: 'u' }),
    ).resolves.toBeUndefined();
  });
});
