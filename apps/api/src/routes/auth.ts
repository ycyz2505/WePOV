import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { getPool, withTransaction } from '@wepov/database'
import {
  hashPassword,
  hashToken,
  verifyContainedPassword,
  writeAudit,
} from '@wepov/security'
import { ApiError, validationError } from '../errors.js'
import {
  changePasswordSchema,
  idleTimeoutSchema,
  loginSchema,
} from '../schemas.js'
import { clientIp, requireAuth, sendRetryAfter } from '../lib/auth-guards.js'
import { clearRefreshCookie, clearStreamCookie, setRefreshCookie, setStreamCookie, REFRESH_MAX_AGE_SECONDS } from '../lib/cookies.js'
import { loadSessionUser } from '../lib/session-user.js'
import { recordSemanticEvent } from '../lib/telemetry.js'
import type { LoginResultDto, SessionInfoDto } from '../dto.js'

/**
 * Login, session probe, refresh, logout, password change and the temporary
 * session idle window (§4.4–§4.6).
 *
 * Login: the user may type noise around their real password (防窥). We locate
 * the one substring whose server-keyed match tag matches, then run exactly one
 * Argon2id verify. Failures are counted per account and lock for 15 minutes
 * after 5 attempts; successes clear the counter.
 */

interface LoginRow {
  user_id: string
  class_id: string
  temporary_idle_minutes: number
  password_hash: string | null
  password_length: number | null
  match_tag: string | null
  must_change: boolean | null
}

const LOGIN_LOOKUP = `
  SELECT u.id AS user_id, cm.class_id, u.temporary_idle_minutes,
         pc.password_hash, pc.password_length, pc.match_tag, pc.must_change
    FROM users u
    JOIN class_members cm ON cm.user_id = u.id
    LEFT JOIN password_credentials pc ON pc.user_id = u.id
   WHERE u.id = $1
     AND u.is_active = true
     AND u.deleted_at IS NULL
   ORDER BY cm.joined_at
   LIMIT 1
`

export const authRoutes: FastifyPluginAsync = async (app) => {
  const cookieConfig = { secure: app.config.isProduction }

  app.post('/api/v1/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = loginSchema.safeParse(request.body)
    if (!parsed.success) throw validationError(parsed.error.issues)
    const { userId, passwordInput, mode, deviceId, deviceName } = parsed.data

    // Dedicated login tier: per account and per client IP.
    const accountDecision = app.rateLimiter.consume('login', `user:${userId}`)
    if (!accountDecision.allowed) {
      const seconds = Math.max(1, Math.ceil(accountDecision.retryAfterMs / 1000))
      sendRetryAfter(reply, seconds)
      throw ApiError.tooManyRequests('尝试过于频繁，请稍后再试', seconds)
    }
    const ip = clientIp(request)
    if (ip) {
      const ipDecision = app.rateLimiter.consume('login', `ip:${ip}`)
      if (!ipDecision.allowed) {
        const seconds = Math.max(1, Math.ceil(ipDecision.retryAfterMs / 1000))
        sendRetryAfter(reply, seconds)
        throw ApiError.tooManyRequests('尝试过于频繁，请稍后再试', seconds)
      }
    }

    const lookup = await getPool().query<LoginRow>(LOGIN_LOOKUP, [userId])
    const row = lookup.rows[0]
    // The same generic error for unknown user and wrong password: never reveal
    // whether an account exists.
    const invalid = ApiError.unauthorized('invalid_credentials', '账号或密码不正确')
    if (!row || !row.password_hash || !row.match_tag || !row.password_length) {
      throw invalid
    }

    const lock = await app.loginFailures.check(userId)
    if (lock.locked) {
      throw new ApiError(423, 'account_locked', '尝试次数过多，请稍后再试', {
        retryAfterSeconds: lock.retryAfterSeconds,
      })
    }

    const verified = await verifyContainedPassword(
      app.config.security.passwordMatchKey,
      passwordInput,
      { hash: row.password_hash, length: row.password_length, matchTag: row.match_tag },
    )

    if (!verified.ok) {
      const after = await app.loginFailures.recordFailure(userId)
      if (after.locked) {
        throw new ApiError(423, 'account_locked', '尝试次数过多，账号已暂时锁定', {
          retryAfterSeconds: after.retryAfterSeconds,
        })
      }
      throw invalid
    }

    await app.loginFailures.clear(userId)

    await getPool().query(
      `INSERT INTO devices (class_id, user_id, device_id, device_name)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (class_id, user_id, device_id)
       DO UPDATE SET device_name = EXCLUDED.device_name, last_seen_at = now()`,
      [row.class_id, userId, deviceId, deviceName],
    )

    const issue = await app.sessions.create({
      classId: row.class_id,
      userId,
      deviceId,
      mode,
      temporaryIdleMinutes: row.temporary_idle_minutes,
    })

    if (mode === 'persistent' && issue.refreshToken) {
      setRefreshCookie(reply, cookieConfig, issue.refreshToken)
    }
    // EventSource cannot send headers; this HttpOnly cookie lets the notification
    // stream authenticate without putting a token in the URL.
    setStreamCookie(
      reply,
      cookieConfig,
      issue.accessToken,
      mode === 'persistent' ? REFRESH_MAX_AGE_SECONDS : Math.max(60, row.temporary_idle_minutes * 60),
    )

    const user = await loadSessionUser(app, row.class_id, userId)
    if (!user) throw invalid

    await recordSemanticEvent({
      classId: row.class_id,
      userId,
      eventType: 'auth.login',
      metadata: { mode, deviceName },
      requestId: (request as FastifyRequest & { requestId?: string }).requestId ?? null,
    })

    const body: LoginResultDto = {
      user,
      mode,
      idleTimeoutMinutes: row.temporary_idle_minutes,
      token: issue.accessToken,
    }
    return body
  })

  app.get('/api/v1/auth/session', async (request: FastifyRequest): Promise<SessionInfoDto> => {
    const auth = requireAuth(request)
    const user = await loadSessionUser(app, auth.classId, auth.userId)
    if (!user) throw ApiError.unauthorized()

    const meta = await getPool().query<{ issued_at: Date; expires_at: Date }>(
      `SELECT s.created_at AS issued_at,
              LEAST(s.idle_expires_at, f.absolute_expires_at) AS expires_at
         FROM sessions s JOIN session_families f ON f.id = s.family_id
        WHERE s.id = $1`,
      [auth.sessionId],
    )
    const row = meta.rows[0]
    const expiresAt = row?.expires_at ?? new Date(Date.now() + auth.idleTimeoutMinutes * 60_000)
    return {
      user,
      mode: auth.mode,
      idleTimeoutMinutes: auth.idleTimeoutMinutes,
      issuedAt: (row?.issued_at ?? new Date()).toISOString(),
      expiresAt: expiresAt.toISOString(),
    }
  })

  // Mint a new access token from the persistent refresh cookie. Rotation also
  // detects replay of a consumed token and revokes the whole family.
  app.post('/api/v1/auth/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies['wepov_refresh']
    if (!token) throw ApiError.unauthorized('refresh_missing', '登录状态已失效，请重新登录')

    const result = await app.sessions.rotate(token)
    if (!result.ok) {
      clearRefreshCookie(reply, cookieConfig)
      throw ApiError.unauthorized('refresh_invalid', '登录状态已失效，请重新登录')
    }

    setRefreshCookie(reply, cookieConfig, result.issue.refreshToken ?? '')
    setStreamCookie(reply, cookieConfig, result.issue.accessToken, REFRESH_MAX_AGE_SECONDS)

    const owner = await getPool().query<{ user_id: string; class_id: string; idle_timeout_minutes: number }>(
      `SELECT s.user_id, s.class_id, u.temporary_idle_minutes AS idle_timeout_minutes
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = $1`,
      [result.issue.sessionId],
    )
    const row = owner.rows[0]
    if (!row) throw ApiError.unauthorized('refresh_invalid', '登录状态已失效，请重新登录')

    const user = await loadSessionUser(app, row.class_id, row.user_id)
    if (!user) throw ApiError.unauthorized('refresh_invalid', '登录状态已失效，请重新登录')

    const body: LoginResultDto = {
      user,
      mode: 'persistent',
      idleTimeoutMinutes: row.idle_timeout_minutes,
      token: result.issue.accessToken,
    }
    return body
  })

  app.post('/api/v1/auth/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    clearRefreshCookie(reply, cookieConfig)
    clearStreamCookie(reply, cookieConfig)

    let sessionId: string | null = request.auth?.sessionId ?? null
    let familyId: string | null = request.auth?.familyId ?? null

    // `sendBeacon` on tab close cannot set an Authorization header; it posts
    // the token in the body instead.
    if (!sessionId) {
      const body = request.body as { token?: unknown } | undefined
      const token = typeof body?.token === 'string' ? body.token : null
      if (token && token.length > 0) {
        const hash = hashToken(app.config.security.sessionPepper, 'access', token)
        const found = await getPool().query<{ id: string; family_id: string }>(
          `SELECT id, family_id FROM sessions WHERE access_token_hash = $1`,
          [hash],
        )
        sessionId = found.rows[0]?.id ?? null
        familyId = found.rows[0]?.family_id ?? null
      }
    }

    if (sessionId) await app.sessions.revoke(sessionId, 'logout')
    if (familyId) await app.sessions.revokeAllForUser([familyId], 'logout')
    reply.status(204)
  })

  app.post('/api/v1/auth/password', async (request: FastifyRequest) => {
    const auth = requireAuth(request)
    const parsed = changePasswordSchema.safeParse(request.body)
    if (!parsed.success) throw validationError(parsed.error.issues)
    const { currentPasswordInput, newPassword } = parsed.data
    if (newPassword === currentPasswordInput) {
      throw ApiError.badRequest('password_unchanged', '新密码不能与当前密码相同')
    }

    const credential = await getPool().query<{
      password_hash: string
      password_length: number
      match_tag: string
    }>(
      `SELECT password_hash, password_length, match_tag FROM password_credentials WHERE user_id = $1`,
      [auth.userId],
    )
    const row = credential.rows[0]
    if (!row) throw ApiError.unauthorized('invalid_credentials', '账号或密码不正确')

    const verified = await verifyContainedPassword(
      app.config.security.passwordMatchKey,
      currentPasswordInput,
      { hash: row.password_hash, length: row.password_length, matchTag: row.match_tag },
    )
    if (!verified.ok) {
      throw ApiError.badRequest('password_incorrect', '当前密码不正确')
    }

    const next = await hashPassword(app.config.security.passwordMatchKey, newPassword)

    await withTransaction(async (tx) => {
      await tx.query(
        `UPDATE password_credentials
            SET password_hash = $2, password_length = $3, match_tag = $4,
                match_tag_version = 1, must_change = false
          WHERE user_id = $1`,
        [auth.userId, next.hash, next.length, next.matchTag],
      )
      await writeAudit(tx, {
        classId: auth.classId,
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'auth.password_change',
        targetType: 'user',
        targetId: auth.userId,
        sessionId: auth.sessionId,
        requestId: (request as FastifyRequest & { requestId?: string }).requestId ?? null,
        ipHmac: request.ipHmac,
      })
      // Every other device must log in again with the new password.
      await tx.query(
        `UPDATE session_families SET revoked_at = now(), revoked_reason = 'password_change'
          WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL`,
        [auth.userId, auth.familyId],
      )
      await tx.query(
        `UPDATE sessions SET revoked_at = now(), revoked_reason = 'password_change'
          WHERE user_id = $1 AND family_id <> $2 AND revoked_at IS NULL`,
        [auth.userId, auth.familyId],
      )
    })

    await app.loginFailures.clear(auth.userId)
    return { ok: true as const }
  })

  app.patch('/api/v1/auth/idle-timeout', async (request: FastifyRequest) => {
    const auth = requireAuth(request)
    const parsed = idleTimeoutSchema.safeParse(request.body)
    if (!parsed.success) throw validationError(parsed.error.issues)

    await getPool().query(`UPDATE users SET temporary_idle_minutes = $2 WHERE id = $1`, [
      auth.userId,
      parsed.data.minutes,
    ])

    // Re-anchor the current temporary session so the new window applies now.
    if (auth.mode === 'temporary') {
      const expires = new Date(Date.now() + parsed.data.minutes * 60_000)
      await getPool().query(`UPDATE sessions SET idle_expires_at = $2 WHERE id = $1`, [
        auth.sessionId,
        expires,
      ])
    }

    return { idleTimeoutMinutes: parsed.data.minutes }
  })
}
