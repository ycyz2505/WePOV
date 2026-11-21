import { getPool } from '@wepov/database'
import type { AppConfig } from '../config.js'

/**
 * Semantic events (§14.3) and the compact HTTP request index (§14.2, §14.4).
 *
 * These writes are best-effort for request logging (a failure must not break a
 * business response) but semantic events for security-relevant actions should
 * be written inside the caller's transaction where noted. The helpers here take
 * an optional transaction handle.
 */

export interface SemanticEventInput {
  classId: string
  userId: string | null
  eventType: string
  targetType?: string | null
  targetId?: string | null
  metadata?: Record<string, unknown>
  requestId?: string | null
}

type Querier = {
  query: (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null }>
}

export async function recordSemanticEvent(input: SemanticEventInput, tx?: Querier): Promise<void> {
  const sql = `INSERT INTO semantic_events
      (class_id, user_id, event_type, target_type, target_id, metadata, request_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`
  const params = [
    input.classId,
    input.userId,
    input.eventType,
    input.targetType ?? null,
    input.targetId ?? null,
    JSON.stringify(input.metadata ?? {}),
    input.requestId ?? null,
  ]
  if (tx) {
    await tx.query(sql, params)
    return
  }
  try {
    await getPool().query(sql, params)
  } catch {
    // Never let telemetry break a response.
  }
}

export interface RequestLogInput {
  requestId: string
  classId: string | null
  route: string
  method: string
  statusCode: number
  durationMs: number
  responseBytes: number
  userHmac: string | null
  sessionHmac: string | null
  deviceHmac: string | null
  ipEnc: unknown
  userAgentEnc: unknown
  ipHmac: string | null
  rateLimited: boolean
  timedOut: boolean
  errorClass: string | null
  deployVersion: string | null
}

export async function recordRequestLog(input: RequestLogInput): Promise<void> {
  try {
    await getPool().query(
      `INSERT INTO request_log_index
         (request_id, class_id, route, method, status_code, duration_ms, response_bytes,
          user_hmac, session_hmac, device_hmac, ip_enc, user_agent_enc, ip_hmac,
          rate_limited, timed_out, error_class, deploy_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        input.requestId,
        input.classId,
        input.route,
        input.method,
        input.statusCode,
        Math.max(0, Math.round(input.durationMs)),
        input.responseBytes,
        input.userHmac,
        input.sessionHmac,
        input.deviceHmac,
        input.ipEnc === null || input.ipEnc === undefined ? null : JSON.stringify(input.ipEnc),
        input.userAgentEnc === null || input.userAgentEnc === undefined ? null : JSON.stringify(input.userAgentEnc),
        input.ipHmac,
        input.rateLimited,
        input.timedOut,
        input.errorClass,
        input.deployVersion,
      ],
    )
  } catch {
    // Best-effort; a logging failure must not surface to the client.
  }
}

/** Encrypt exact IP and User-Agent for the log index using the log keyring. */
export function encryptLogFields(config: AppConfig, ip: string | null, userAgent: string | null): {
  ipEnc: unknown
  userAgentEnc: unknown
} {
  const keyring = config.security.encryption
  return {
    ipEnc: ip ? keyring.seal(ip, 'log:ip') : null,
    userAgentEnc: userAgent ? keyring.seal(userAgent, 'log:ua') : null,
  }
}
