import { supabaseAdmin } from '../db/supabaseClient';

export type AuditAction =
  | 'session.created'
  | 'session.finalized'
  | 'session.cancelled'
  | 'qr.generated'
  | 'qr.redeemed'
  | 'session.rollback';

export type AuditEvent = {
  action: AuditAction | string;
  sessionId?: string | null;
  userId?: string | null;
  details?: Record<string, unknown>;
};

/**
 * Inserta una fila en `sf_audit_log`.
 *
 * Fire-and-forget en intención: si falla la escritura del log, no debe romper
 * la operación principal. Log a consola del error y seguimos.
 *
 * **Importante**: a pesar de "fire-and-forget", el caller decide si await-ear
 * o no. Para tests deterministas conviene await-ear.
 */
export const logAudit = async (event: AuditEvent): Promise<void> => {
  try {
    const { error } = await supabaseAdmin.from('sf_audit_log').insert({
      session_id: event.sessionId ?? null,
      user_id: event.userId ?? null,
      action: event.action,
      details: event.details ?? {},
    });

    if (error) {
      console.error('[audit] insert failed:', event.action, error.message);
    }
  } catch (err) {
    console.error('[audit] threw:', event.action, err);
  }
};
