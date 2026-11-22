import type { FastifyRequest, FastifyReply } from 'fastify'
import fp from 'fastify-plugin'
import { hashToken, PERMISSIONS } from '@wepov/security'
import { getPool } from '@wepov/database'
import { ApiError } from '../errors.js'
import { clientIp } from '../lib/auth-guards.js'
import { ipPseudonym } from '../lib/notifications.js'

/**
 * Auth resolution plugin.
 *
 * Accepts EITHER:
 * - `Authorization: Bearer <token>` (temporary + persistent sessions), or
 * - a persistent refresh cookie, which is *not* an access credential — it only
 *   lets /auth/refresh mint a new access token. We therefore do NOT authenticate
 *   requests from the cookie alone; routes that need it call the refresh flow.
 *
 * Resolution sets `request.auth` with the server-resolved role from
 * role_assignments (never trusted from the client).
 */

interface AuthRow {
  session_id: string
  family_id: string
  user_id: string
  class_id: string
  device_id: string
  mode: 'temporary' | 'persistent'
  idle_timeout_minutes: number
  nickname: string
  real_name: string
  gender: string
  avatar_object_key: string | null
  must_change: boolean | null
  muted_until: Date | null
  role: 'student' | 'general_admin' | 'super_admin'
}

const RESOLVE_SQL = `
  SELECT s.id AS session_id, s.family_id, s.user_id, s.class_id, s.device_id, s.mode,
         u.temporary_idle_minutes AS idle_timeout_minutes,
         p.nickname, p.avatar_object_key, cm.real_name, cm.gender, cm.muted_until,
         pc.must_change,
         COALESCE(ra.role, 'student') AS role
    FROM sessions s
    JOIN session_families f ON f.id = s.family_id
    JOIN users u ON u.id = s.user_id
    JOIN class_members cm ON cm.user_id = s.user_id AND cm.class_id = s.class_id
    JOIN profiles p ON p.user_id = s.user_id
    LEFT JOIN password_credentials pc ON pc.user_id = s.user_id
    LEFT JOIN role_assignments ra ON ra.user_id = s.user_id AND ra.class_id = s.class_id AND ra.revoked_at IS NULL
   WHERE s.access_token_hash = $1
     AND s.revoked_at IS NULL
     AND f.revoked_at IS NULL
     AND u.is_active = true
     AND u.deleted_at IS NULL
     AND s.idle_expires_at > now()
     AND f.absolute_expires_at > now()
`

export const authPlugin = fp(async (app) => {
  app.decorateRequest('auth', null)
  app.decorateRequest('gatewayVerified', false)
  app.decorateRequest('ipHmac', null)

  app.decorate('requireAuth', (request: FastifyRequest) => {
    if (!request.auth) throw ApiError.unauthorized()
    return request.auth
  })

  app.addHook('onRequest', async (request: FastifyRequest, _reply: FastifyReply) => {
    request.ipHmac = ipPseudonym(app.config, clientIp(request))

    const header = request.headers.authorization
    if (!header || !header.startsWith('Bearer ')) {
      return
    }
    const token = header.slice('Bearer '.length).trim()
    if (token.length === 0) return

    const hash = hashToken(app.config.security.sessionPepper, 'access', token)
    const result = await getPool().query<AuthRow>(RESOLVE_SQL, [hash])
    const row = result.rows[0]
    if (!row) return

    request.auth = {
      userId: row.user_id,
      classId: row.class_id,
      sessionId: row.session_id,
      familyId: row.family_id,
      deviceId: row.device_id,
      mode: row.mode,
      role: row.role,
      nickname: row.nickname,
      realName: row.real_name,
      gender: row.gender,
      avatarObjectKey: row.avatar_object_key,
      mustChangePassword: row.must_change ?? false,
      idleTimeoutMinutes: row.idle_timeout_minutes,
      mutedUntil: row.muted_until,
    }

    // Sliding touch for persistent sessions (fire-and-forget; not awaited so
    // it never adds latency to the request path).
    if (row.mode === 'persistent') {
      const sliding = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      void getPool()
        .query(
          `UPDATE sessions SET last_used_at = now(),
             idle_expires_at = LEAST($2, (SELECT absolute_expires_at FROM session_families WHERE id = $3))
           WHERE id = $1`,
          [row.session_id, sliding, row.family_id],
        )
        .catch(() => undefined)
    }
  })

  // Helper to check a permission on the resolved auth context.
  app.decorate('hasPermission', (request: FastifyRequest, permission: string): boolean => {
    const role = request.auth?.role ?? 'student'
    if (role === 'super_admin') return true
    if (role === 'general_admin') {
      return (
        permission === PERMISSIONS.moderation || permission === PERMISSIONS.albumReview
      )
    }
    return false
  })
}, { name: 'wepov-auth' })
