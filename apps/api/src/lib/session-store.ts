import type { SessionStore, SessionRecord, SessionMode, LoginFailureStore, LoginFailureState } from '@wepov/security'
import { getPool } from '@wepov/database'

/**
 * Postgres implementations of the security package's store interfaces.
 * All queries are parameterized.
 */

interface SessionRow {
  id: string
  family_id: string
  user_id: string
  class_id: string
  device_id: string
  mode: SessionMode
  access_token_hash: string
  refresh_token_hash: string | null
  previous_refresh_token_hash: string | null
  idle_expires_at: Date
  absolute_expires_at: Date
  last_used_at: Date
  revoked_at: Date | null
  revoked_reason: string | null
}

const SELECT_SESSION = `
  SELECT s.id, s.family_id, s.user_id, s.class_id, s.device_id, s.mode,
         s.access_token_hash, s.refresh_token_hash, s.previous_refresh_token_hash,
         s.idle_expires_at, f.absolute_expires_at, s.last_used_at,
         s.revoked_at, s.revoked_reason
    FROM sessions s
    JOIN session_families f ON f.id = s.family_id
`

function toRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    familyId: row.family_id,
    userId: row.user_id,
    classId: row.class_id,
    deviceId: row.device_id,
    mode: row.mode,
    accessTokenHash: row.access_token_hash,
    refreshTokenHash: row.refresh_token_hash,
    previousRefreshTokenHash: row.previous_refresh_token_hash,
    idleExpiresAt: row.idle_expires_at,
    absoluteExpiresAt: row.absolute_expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    revokedReason: row.revoked_reason,
  }
}

export class PgSessionStore implements SessionStore {
  async createFamily(input: {
    classId: string
    userId: string
    deviceId: string
    mode: SessionMode
    absoluteExpiresAt: Date
  }): Promise<string> {
    const result = await getPool().query<{ id: string }>(
      `INSERT INTO session_families (class_id, user_id, device_id, mode, absolute_expires_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [input.classId, input.userId, input.deviceId, input.mode, input.absoluteExpiresAt],
    )
    return result.rows[0]!.id
  }

  async insertSession(record: Omit<SessionRecord, 'id'>): Promise<string> {
    const result = await getPool().query<{ id: string }>(
      `INSERT INTO sessions
         (family_id, user_id, class_id, device_id, mode, access_token_hash,
          refresh_token_hash, previous_refresh_token_hash, idle_expires_at, last_used_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        record.familyId,
        record.userId,
        record.classId,
        record.deviceId,
        record.mode,
        record.accessTokenHash,
        record.refreshTokenHash,
        record.previousRefreshTokenHash,
        record.idleExpiresAt,
        record.lastUsedAt,
      ],
    )
    return result.rows[0]!.id
  }

  async findByAccessHash(hash: string): Promise<SessionRecord | null> {
    const result = await getPool().query<SessionRow>(`${SELECT_SESSION} WHERE s.access_token_hash = $1`, [hash])
    return result.rows[0] ? toRecord(result.rows[0]) : null
  }

  async findByRefreshHash(hash: string): Promise<SessionRecord | null> {
    const result = await getPool().query<SessionRow>(`${SELECT_SESSION} WHERE s.refresh_token_hash = $1`, [hash])
    return result.rows[0] ? toRecord(result.rows[0]) : null
  }

  async findByPreviousRefreshHash(hash: string): Promise<SessionRecord | null> {
    const result = await getPool().query<SessionRow>(
      `${SELECT_SESSION} WHERE s.previous_refresh_token_hash = $1`,
      [hash],
    )
    return result.rows[0] ? toRecord(result.rows[0]) : null
  }

  async rotate(input: {
    oldSessionId: string
    newRefreshHash: string
    previousRefreshHash: string
    newAccessHash: string
    idleExpiresAt: Date
  }): Promise<void> {
    // Rotate in place: the session row keeps its id/family but gets a fresh
    // access hash, a new refresh hash and remembers the consumed one for reuse
    // detection.
    await getPool().query(
      `UPDATE sessions
          SET access_token_hash = $2,
              refresh_token_hash = $3,
              previous_refresh_token_hash = $4,
              idle_expires_at = $5,
              last_used_at = now()
        WHERE id = $1`,
      [input.oldSessionId, input.newAccessHash, input.newRefreshHash, input.previousRefreshHash, input.idleExpiresAt],
    )
  }

  async revokeSession(sessionId: string, reason: string): Promise<void> {
    await getPool().query(
      `UPDATE sessions SET revoked_at = now(), revoked_reason = $2 WHERE id = $1 AND revoked_at IS NULL`,
      [sessionId, reason],
    )
  }

  async revokeFamily(familyId: string, reason: string): Promise<void> {
    const client = await getPool().connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `UPDATE session_families SET revoked_at = now(), revoked_reason = $2
          WHERE id = $1 AND revoked_at IS NULL`,
        [familyId, reason],
      )
      await client.query(
        `UPDATE sessions SET revoked_at = now(), revoked_reason = $2
          WHERE family_id = $1 AND revoked_at IS NULL`,
        [familyId, reason],
      )
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async touchSession(sessionId: string, idleExpiresAt: Date): Promise<void> {
    await getPool().query(
      `UPDATE sessions SET last_used_at = now(), idle_expires_at = $2 WHERE id = $1 AND revoked_at IS NULL`,
      [sessionId, idleExpiresAt],
    )
  }
}

export class PgLoginFailureStore implements LoginFailureStore {
  async get(userId: string): Promise<LoginFailureState> {
    const result = await getPool().query<{ failed_count: number; locked_until: Date | null }>(
      `SELECT failed_count, locked_until FROM login_failures WHERE user_id = $1`,
      [userId],
    )
    const row = result.rows[0]
    return { failedCount: row?.failed_count ?? 0, lockedUntil: row?.locked_until ?? null }
  }

  async recordFailure(userId: string, state: LoginFailureState): Promise<void> {
    // class_id is required by the schema; resolve it from the member row.
    await getPool().query(
      `INSERT INTO login_failures (user_id, class_id, failed_count, locked_until, last_failed_at, updated_at)
       SELECT $1, cm.class_id, $2, $3, now(), now()
         FROM class_members cm WHERE cm.user_id = $1
       ON CONFLICT (user_id) DO UPDATE
         SET failed_count = EXCLUDED.failed_count,
             locked_until = EXCLUDED.locked_until,
             last_failed_at = now(),
             updated_at = now()`,
      [userId, state.failedCount, state.lockedUntil],
    )
  }

  async clear(userId: string): Promise<void> {
    await getPool().query(
      `UPDATE login_failures SET failed_count = 0, locked_until = NULL, updated_at = now() WHERE user_id = $1`,
      [userId],
    )
  }
}
