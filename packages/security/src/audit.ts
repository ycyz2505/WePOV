/**
 * Audit writer (§15.2).
 *
 * Sensitive operations must write an audit row in the SAME transaction as the
 * operation. If the audit insert fails, the whole transaction must roll back.
 * This module therefore only *inserts* through a caller-supplied transaction
 * handle; it never swallows errors and never opens its own connection.
 *
 * The `audit_events` table is append-only at the storage layer (migration 002).
 */

export interface AuditQuery {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>
}

export interface AuditEntry {
  classId: string
  actorId: string | null
  actorRole: string
  action: string
  targetType?: string | null
  targetId?: string | null
  beforeState?: unknown
  afterState?: unknown
  sessionId?: string | null
  requestId?: string | null
  ipHmac?: string | null
}

export class AuditError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuditError'
  }
}

/**
 * Insert an audit row and return its id. Throws on any failure so the caller's
 * transaction aborts. Callers that need the id (e.g. moderation_actions.audit_event_id)
 * use the return value.
 */
export async function writeAudit(tx: AuditQuery, entry: AuditEntry): Promise<string> {
  if (!entry.action || entry.action.length > 80) {
    throw new AuditError('Invalid audit action')
  }
  const result = await tx.query(
    `INSERT INTO audit_events
       (class_id, actor_id, actor_role, action, target_type, target_id,
        before_state, after_state, session_id, request_id, ip_hmac)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id`,
    [
      entry.classId,
      entry.actorId,
      entry.actorRole,
      entry.action,
      entry.targetType ?? null,
      entry.targetId ?? null,
      entry.beforeState === undefined ? null : JSON.stringify(entry.beforeState),
      entry.afterState === undefined ? null : JSON.stringify(entry.afterState),
      entry.sessionId ?? null,
      entry.requestId ?? null,
      entry.ipHmac ?? null,
    ],
  )
  const id = result.rows[0]?.['id']
  if (typeof id !== 'string') {
    throw new AuditError('Audit insert returned no id')
  }
  return id
}
