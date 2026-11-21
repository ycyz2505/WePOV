import { issueToken, hashToken, type IssuedToken } from './tokens.js'

/**
 * Session families with rotating refresh tokens (§4.5, §4.6).
 *
 * Model:
 * - A *family* is one device login. It has an absolute expiry (90 days) and a
 *   sliding idle expiry (30 days) refreshed on each rotation.
 * - Each rotation issues a new refresh token and marks the previous one as
 *   "consumed". If a consumed token is presented again we treat it as theft:
 *   revoke the whole family and raise a security alert (reuse detection).
 * - Temporary logins have no refresh token; they expire on the idle window
 *   (user-configurable 1–120 min) and are revoked on logout.
 *
 * The store is abstracted so this package has no `pg` dependency. The API
 * supplies a Postgres-backed store.
 */

export const PERSISTENT_IDLE_MS = 30 * 24 * 60 * 60 * 1000
export const PERSISTENT_ABSOLUTE_MS = 90 * 24 * 60 * 60 * 1000

export type SessionMode = 'temporary' | 'persistent'

export interface SessionRecord {
  id: string
  familyId: string
  userId: string
  classId: string
  deviceId: string
  mode: SessionMode
  accessTokenHash: string
  refreshTokenHash: string | null
  /** Hash of the refresh token that this rotation replaced (for reuse detection). */
  previousRefreshTokenHash: string | null
  idleExpiresAt: Date
  absoluteExpiresAt: Date
  lastUsedAt: Date
  revokedAt: Date | null
  revokedReason: string | null
}

export interface SessionStore {
  createFamily(input: {
    classId: string
    userId: string
    deviceId: string
    mode: SessionMode
    absoluteExpiresAt: Date
  }): Promise<string>
  insertSession(record: Omit<SessionRecord, 'id'>): Promise<string>
  findByAccessHash(hash: string): Promise<SessionRecord | null>
  findByRefreshHash(hash: string): Promise<SessionRecord | null>
  /** Find a session whose *previous* refresh hash matches (reuse detection). */
  findByPreviousRefreshHash(hash: string): Promise<SessionRecord | null>
  /** Rotate: mark old session consumed, return nothing. */
  rotate(input: {
    oldSessionId: string
    newRefreshHash: string
    previousRefreshHash: string
    newAccessHash: string
    idleExpiresAt: Date
  }): Promise<void>
  revokeSession(sessionId: string, reason: string): Promise<void>
  revokeFamily(familyId: string, reason: string): Promise<void>
  touchSession(sessionId: string, idleExpiresAt: Date): Promise<void>
}

export interface SessionIssue {
  accessToken: string
  refreshToken: string | null
  sessionId: string
  familyId: string
  idleExpiresAt: Date
  absoluteExpiresAt: Date
}

export interface CreateSessionInput {
  classId: string
  userId: string
  deviceId: string
  mode: SessionMode
  temporaryIdleMinutes: number
  now?: Date
}

export class SessionManager {
  readonly #store: SessionStore
  readonly #pepper: Buffer

  constructor(store: SessionStore, pepper: Buffer) {
    this.#store = store
    this.#pepper = pepper
  }

  async create(input: CreateSessionInput): Promise<SessionIssue> {
    const now = input.now ?? new Date()
    const isPersistent = input.mode === 'persistent'
    const idleMs = isPersistent
      ? PERSISTENT_IDLE_MS
      : Math.min(Math.max(input.temporaryIdleMinutes, 1), 120) * 60 * 1000
    const absoluteExpiresAt = new Date(now.getTime() + (isPersistent ? PERSISTENT_ABSOLUTE_MS : idleMs))
    const idleExpiresAt = new Date(now.getTime() + idleMs)

    const familyId = await this.#store.createFamily({
      classId: input.classId,
      userId: input.userId,
      deviceId: input.deviceId,
      mode: input.mode,
      absoluteExpiresAt,
    })

    const access = issueToken(this.#pepper, 'access')
    const refresh = isPersistent ? issueToken(this.#pepper, 'refresh') : null

    const sessionId = await this.#store.insertSession({
      familyId,
      userId: input.userId,
      classId: input.classId,
      deviceId: input.deviceId,
      mode: input.mode,
      accessTokenHash: access.hash,
      refreshTokenHash: refresh ? refresh.hash : null,
      previousRefreshTokenHash: null,
      idleExpiresAt,
      absoluteExpiresAt,
      lastUsedAt: now,
      revokedAt: null,
      revokedReason: null,
    })

    return {
      accessToken: access.token,
      refreshToken: refresh ? refresh.token : null,
      sessionId,
      familyId,
      idleExpiresAt,
      absoluteExpiresAt,
    }
  }

  /** Resolve an access token to its session, or null if invalid/expired/revoked. */
  async authenticate(accessToken: string, now: Date = new Date()): Promise<SessionRecord | null> {
    const hash = hashToken(this.#pepper, 'access', accessToken)
    const record = await this.#store.findByAccessHash(hash)
    if (!record) return null
    if (record.revokedAt) return null
    if (record.idleExpiresAt.getTime() <= now.getTime()) return null
    if (record.absoluteExpiresAt.getTime() <= now.getTime()) return null
    return record
  }

  /**
   * Rotate a refresh token. Returns a new token pair, or a discriminated
   * result describing why it failed. Reuse of a consumed token revokes the
   * family.
   */
  async rotate(
    refreshToken: string,
    now: Date = new Date(),
  ): Promise<
    | { ok: true; issue: SessionIssue }
    | { ok: false; reason: 'invalid' | 'expired' | 'revoked' | 'reuse' }
  > {
    const hash = hashToken(this.#pepper, 'refresh', refreshToken)

    const reused = await this.#store.findByPreviousRefreshHash(hash)
    if (reused) {
      // A token that was already rotated is being replayed: revoke the family.
      await this.#store.revokeFamily(reused.familyId, 'refresh_reuse')
      return { ok: false, reason: 'reuse' }
    }

    const record = await this.#store.findByRefreshHash(hash)
    if (!record) return { ok: false, reason: 'invalid' }
    if (record.revokedAt) return { ok: false, reason: 'revoked' }
    if (record.idleExpiresAt.getTime() <= now.getTime()) return { ok: false, reason: 'expired' }
    if (record.absoluteExpiresAt.getTime() <= now.getTime()) return { ok: false, reason: 'expired' }

    // Sliding window is bounded by the absolute expiry.
    const sliding = new Date(now.getTime() + PERSISTENT_IDLE_MS)
    const idleExpiresAt = sliding.getTime() < record.absoluteExpiresAt.getTime() ? sliding : record.absoluteExpiresAt

    const access = issueToken(this.#pepper, 'access')
    const nextRefresh = issueToken(this.#pepper, 'refresh')

    await this.#store.rotate({
      oldSessionId: record.id,
      newRefreshHash: nextRefresh.hash,
      previousRefreshHash: hash,
      newAccessHash: access.hash,
      idleExpiresAt,
    })

    return {
      ok: true,
      issue: {
        accessToken: access.token,
        refreshToken: nextRefresh.token,
        sessionId: record.id,
        familyId: record.familyId,
        idleExpiresAt,
        absoluteExpiresAt: record.absoluteExpiresAt,
      },
    }
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    await this.#store.revokeSession(sessionId, reason)
  }

  async revokeAllForUser(familyIds: string[], reason: string): Promise<void> {
    for (const familyId of familyIds) {
      await this.#store.revokeFamily(familyId, reason)
    }
  }

  async touch(sessionId: string, now: Date = new Date()): Promise<void> {
    await this.#store.touchSession(sessionId, new Date(now.getTime() + PERSISTENT_IDLE_MS))
  }
}

export type { IssuedToken }
