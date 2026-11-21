import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { gatewayVerifySchema } from '../schemas.js'
import { getPool } from '@wepov/database'
import { issueToken, hashGatewayPasscode, safeEqualString } from '@wepov/security'
import { ApiError, validationError } from '../errors.js'
import { setGatewayCookie, readCookie, GATEWAY_COOKIE } from '../lib/cookies.js'
import { resolveGatewayToken } from '../lib/gateway.js'
import { pinyinInitials } from '../lib/pinyin.js'

/**
 * Minimal privacy gateway (§4.1, §4.2) — cookie contract.
 *
 * The gateway only checks the shared class passcode. It stores a peppered
 * SHA-256 hash of the passcode, never plaintext. On success it issues an opaque
 * admission token (hashed at rest in `gateway_credentials`) and sets it in the
 * HttpOnly `wepov_gateway` cookie:
 *   - rememberDevice=false → session cookie (no Max-Age)
 *   - rememberDevice=true  → 90-day cookie
 * The response body is exactly `{ verified: true }`.
 */

const SHORT_TTL_MS = 12 * 60 * 60 * 1000
const REMEMBER_TTL_MS = 90 * 24 * 60 * 60 * 1000

interface ClassRow {
  id: string
  gateway_passcode_hash: string
  gateway_passcode_version: number
}

/** Compute pinyin initials: split on whitespace or hyphen, take first letter. */
export const gatewayRoutes: FastifyPluginAsync = async (app) => {
  const cookieConfig = { secure: app.config.isProduction }

  app.post('/api/v1/gateway/verify', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = gatewayVerifySchema.safeParse(request.body)
    if (!parsed.success) throw validationError(parsed.error.issues)
    const { passcode, rememberDevice } = parsed.data

    const classResult = await getPool().query<ClassRow>(
      `SELECT id, gateway_passcode_hash, gateway_passcode_version FROM classes LIMIT 1`,
    )
    const classRow = classResult.rows[0]
    if (!classRow) throw ApiError.serviceUnavailable('班级尚未初始化', 30)

    const candidate = hashGatewayPasscode(
      app.config.gatewayPepper,
      classRow.gateway_passcode_version,
      passcode,
    )
    if (!safeEqualString(candidate, classRow.gateway_passcode_hash)) {
      throw ApiError.unauthorized('gateway_invalid', '班级口令不正确')
    }

    const ttlMs = rememberDevice ? REMEMBER_TTL_MS : SHORT_TTL_MS
    const token = issueToken(app.config.security.sessionPepper, 'gateway')
    const expiresAt = new Date(Date.now() + ttlMs)
    await getPool().query(
      `INSERT INTO gateway_credentials (class_id, token_hash, remember, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [classRow.id, token.hash, rememberDevice, expiresAt],
    )

    setGatewayCookie(reply, cookieConfig, token.token, rememberDevice, Math.floor(ttlMs / 1000))
    return { verified: true }
  })

  // Status: whether the presented cookie is still valid. Always two fields.
  app.get('/api/v1/gateway/status', async (request: FastifyRequest) => {
    const token = readCookie(request, GATEWAY_COOKIE)
    if (!token) return { verified: false, rememberDevice: false }
    const gateway = await resolveGatewayToken(app, token)
    if (!gateway) return { verified: false, rememberDevice: false }
    return { verified: true, rememberDevice: gateway.remember }
  })

  // Member directory visible only after the gateway (§5.1). The cookie is the
  // only admission; missing/expired → 401 gateway_required.
  app.get('/api/v1/gateway/members', async (request: FastifyRequest) => {
    const token = readCookie(request, GATEWAY_COOKIE)
    const gateway = token ? await resolveGatewayToken(app, token) : null
    if (!gateway) throw ApiError.unauthorized('gateway_required', '请先输入班级口令')

    const result = await getPool().query<{
      user_id: string
      nickname: string
      real_name: string
      gender: string
      real_name_pinyin: string
      nickname_pinyin: string
    }>(
      `SELECT p.user_id, p.nickname, cm.real_name, cm.gender,
              cm.real_name_pinyin, p.nickname_pinyin
         FROM profiles p
         JOIN class_members cm ON cm.user_id = p.user_id AND cm.class_id = p.class_id
         JOIN users u ON u.id = p.user_id AND u.is_active = true AND u.deleted_at IS NULL
        WHERE cm.class_id = $1 AND cm.hidden = false
        ORDER BY cm.student_number NULLS LAST, p.nickname`,
      [gateway.classId],
    )
    return {
      items: result.rows.map((row) => ({
        userId: row.user_id,
        nickname: row.nickname,
        realName: row.real_name,
        gender: row.gender,
        avatarUrl: null,
        pinyinInitials: pinyinInitials(row.real_name_pinyin, row.nickname_pinyin),
      })),
    }
  })
}
