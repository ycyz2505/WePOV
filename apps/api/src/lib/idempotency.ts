import type { FastifyReply, FastifyRequest } from 'fastify'
import { getPool } from '@wepov/database'
import { ApiError } from '../errors.js'
import { idempotencyKey } from './auth-guards.js'

/**
 * Idempotent writes (§19). A client retry after a dropped response must not
 * create a second post, partner ad or upload intent.
 *
 * Flow:
 * 1. No `Idempotency-Key` → run normally (idempotency is opt-in).
 * 2. First attempt claims the key with a 409 placeholder row, then runs.
 * 3. A replay finds the completed row and receives the stored status + body.
 * 4. A concurrent duplicate sees the placeholder and gets 409 `in_progress`.
 * 5. If the handler throws, the claim is released so a retry can work.
 *
 * The key is scoped to (class, user) — one user's key can never read another's
 * stored response.
 */

const TTL_MS = 24 * 60 * 60 * 1000

interface StoredRow {
  status_code: number
  response: unknown
}

export async function idempotent<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  handler: () => Promise<T>,
): Promise<T> {
  const key = idempotencyKey(request)
  const auth = request.auth
  if (!key || !auth) return handler()

  const path = request.url.split('?')[0] ?? request.url

  const claim = await getPool().query(
    `INSERT INTO idempotency_keys
       (class_id, user_id, key, method, path, status_code, response, expires_at)
     VALUES ($1,$2,$3,$4,$5,409,NULL,$6)
     ON CONFLICT (class_id, user_id, key) DO NOTHING`,
    [auth.classId, auth.userId, key, request.method, path, new Date(Date.now() + TTL_MS)],
  )

  if (claim.rowCount === 0) {
    const existing = await getPool().query<StoredRow>(
      `SELECT status_code, response FROM idempotency_keys
        WHERE class_id = $1 AND user_id = $2 AND key = $3 AND expires_at > now()`,
      [auth.classId, auth.userId, key],
    )
    const row = existing.rows[0]
    if (row && row.status_code !== 409) {
      reply.status(row.status_code)
      return row.response as T
    }
    throw ApiError.conflict('request_in_progress', '相同请求正在处理中，请稍候')
  }

  try {
    const result = await handler()
    const status = reply.statusCode >= 400 ? reply.statusCode : 200
    await getPool().query(
      `UPDATE idempotency_keys SET status_code = $4, response = $5
        WHERE class_id = $1 AND user_id = $2 AND key = $3`,
      [auth.classId, auth.userId, key, status, JSON.stringify(result ?? null)],
    )
    return result
  } catch (error) {
    await getPool()
      .query(`DELETE FROM idempotency_keys WHERE class_id = $1 AND user_id = $2 AND key = $3`, [
        auth.classId,
        auth.userId,
        key,
      ])
      .catch(() => undefined)
    throw error
  }
}
