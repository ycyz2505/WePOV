import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import {
  SessionManager,
  PERSISTENT_ABSOLUTE_MS,
  type SessionRecord,
  type SessionStore,
  type SessionMode,
} from '../src/sessions.js'

class MemorySessionStore implements SessionStore {
  readonly families = new Map<string, { revoked: boolean; reason: string | null }>()
  readonly sessions = new Map<string, SessionRecord>()
  #seq = 0

  async createFamily(): Promise<string> {
    this.#seq += 1
    const id = `fam-${this.#seq}`
    this.families.set(id, { revoked: false, reason: null })
    return id
  }

  async insertSession(record: Omit<SessionRecord, 'id'>): Promise<string> {
    this.#seq += 1
    const id = `ses-${this.#seq}`
    this.sessions.set(id, { ...record, id })
    return id
  }

  async findByAccessHash(hash: string): Promise<SessionRecord | null> {
    for (const record of this.sessions.values()) {
      if (record.accessTokenHash === hash) return record
    }
    return null
  }

  async findByRefreshHash(hash: string): Promise<SessionRecord | null> {
    for (const record of this.sessions.values()) {
      if (record.refreshTokenHash === hash) return record
    }
    return null
  }

  async findByPreviousRefreshHash(hash: string): Promise<SessionRecord | null> {
    for (const record of this.sessions.values()) {
      if (record.previousRefreshTokenHash === hash) return record
    }
    return null
  }

  async rotate(input: {
    oldSessionId: string
    newRefreshHash: string
    previousRefreshHash: string
    newAccessHash: string
    idleExpiresAt: Date
  }): Promise<void> {
    const record = this.sessions.get(input.oldSessionId)
    if (!record) throw new Error('missing session')
    // The old row keeps the consumed hash so replay can be detected.
    this.sessions.set(input.oldSessionId, {
      ...record,
      accessTokenHash: `consumed:${record.accessTokenHash}`,
      previousRefreshTokenHash: input.previousRefreshHash,
      refreshTokenHash: null,
    })
    this.#seq += 1
    const id = `ses-${this.#seq}`
    this.sessions.set(id, {
      ...record,
      id,
      accessTokenHash: input.newAccessHash,
      refreshTokenHash: input.newRefreshHash,
      previousRefreshTokenHash: null,
      idleExpiresAt: input.idleExpiresAt,
    })
  }

  async revokeSession(sessionId: string, reason: string): Promise<void> {
    const record = this.sessions.get(sessionId)
    if (record) this.sessions.set(sessionId, { ...record, revokedAt: new Date(), revokedReason: reason })
  }

  async revokeFamily(familyId: string, reason: string): Promise<void> {
    this.families.set(familyId, { revoked: true, reason })
    for (const [id, record] of this.sessions) {
      if (record.familyId === familyId) {
        this.sessions.set(id, { ...record, revokedAt: new Date(), revokedReason: reason })
      }
    }
  }

  async touchSession(sessionId: string, idleExpiresAt: Date): Promise<void> {
    const record = this.sessions.get(sessionId)
    if (record) this.sessions.set(sessionId, { ...record, idleExpiresAt })
  }
}

const pepper = randomBytes(32)

function manager() {
  const store = new MemorySessionStore()
  return { store, sessions: new SessionManager(store, pepper) }
}

const base = {
  classId: 'class-1',
  userId: 'user-1',
  deviceId: 'dev-1',
  mode: 'persistent' as SessionMode,
  temporaryIdleMinutes: 30,
}

test('persistent sessions issue an access and a refresh token', async () => {
  const { sessions } = manager()
  const issue = await sessions.create(base)
  assert.ok(issue.accessToken.length > 0)
  assert.ok(issue.refreshToken)
  assert.equal(issue.familyId.length > 0, true)
})

test('temporary sessions issue no refresh token', async () => {
  const { sessions } = manager()
  const issue = await sessions.create({ ...base, mode: 'temporary' })
  assert.equal(issue.refreshToken, null)
})

test('temporary idle minutes are clamped to 1..120', async () => {
  const { sessions } = manager()
  const now = new Date('2026-01-01T00:00:00Z')
  const short = await sessions.create({ ...base, mode: 'temporary', temporaryIdleMinutes: 0, now })
  assert.equal(short.idleExpiresAt.getTime() - now.getTime(), 60_000)
  const long = await sessions.create({ ...base, mode: 'temporary', temporaryIdleMinutes: 999, now })
  assert.equal(long.idleExpiresAt.getTime() - now.getTime(), 120 * 60_000)
})

test('persistent absolute expiry is 90 days', async () => {
  const { sessions } = manager()
  const now = new Date('2026-01-01T00:00:00Z')
  const issue = await sessions.create({ ...base, now })
  assert.equal(issue.absoluteExpiresAt.getTime() - now.getTime(), PERSISTENT_ABSOLUTE_MS)
})

test('authenticate resolves a live access token', async () => {
  const { sessions } = manager()
  const issue = await sessions.create(base)
  const record = await sessions.authenticate(issue.accessToken)
  assert.ok(record)
  assert.equal(record?.userId, 'user-1')
})

test('authenticate rejects an unknown token', async () => {
  const { sessions } = manager()
  assert.equal(await sessions.authenticate('nope'), null)
})

test('authenticate rejects an idle-expired session', async () => {
  const { sessions } = manager()
  const now = new Date('2026-01-01T00:00:00Z')
  const issue = await sessions.create({ ...base, mode: 'temporary', temporaryIdleMinutes: 5, now })
  const later = new Date(now.getTime() + 6 * 60_000)
  assert.equal(await sessions.authenticate(issue.accessToken, later), null)
})

test('rotation returns a fresh pair', async () => {
  const { sessions } = manager()
  const issue = await sessions.create(base)
  const rotated = await sessions.rotate(issue.refreshToken!)
  assert.equal(rotated.ok, true)
  if (!rotated.ok) return
  assert.notEqual(rotated.issue.refreshToken, issue.refreshToken)
  assert.notEqual(rotated.issue.accessToken, issue.accessToken)
})

test('replaying a consumed refresh token revokes the family', async () => {
  const { store, sessions } = manager()
  const issue = await sessions.create(base)
  const first = await sessions.rotate(issue.refreshToken!)
  assert.equal(first.ok, true)
  const replay = await sessions.rotate(issue.refreshToken!)
  assert.equal(replay.ok, false)
  if (replay.ok) return
  assert.equal(replay.reason, 'reuse')
  assert.equal(store.families.get(issue.familyId)?.revoked, true)
})

test('revoking a session stops authentication', async () => {
  const { sessions } = manager()
  const issue = await sessions.create(base)
  await sessions.revoke(issue.sessionId, 'logout')
  assert.equal(await sessions.authenticate(issue.accessToken), null)
})

test('revokeAllForUser kills every family', async () => {
  const { sessions } = manager()
  const a = await sessions.create({ ...base, deviceId: 'a' })
  const b = await sessions.create({ ...base, deviceId: 'b' })
  await sessions.revokeAllForUser([a.familyId, b.familyId], 'admin')
  assert.equal(await sessions.authenticate(a.accessToken), null)
  assert.equal(await sessions.authenticate(b.accessToken), null)
})

test('an unknown refresh token is invalid, not reuse', async () => {
  const { sessions } = manager()
  const result = await sessions.rotate('bogus-token')
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.reason, 'invalid')
})
