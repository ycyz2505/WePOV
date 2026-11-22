import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import { getPool } from '@wepov/database'
import { ApiError } from '../errors.js'
import { gatewayFromRequest } from '../lib/gateway.js'

/**
 * Class gateway guard (§4.1, §4.2).
 *
 * Every business route under /api/v1 requires a valid `wepov_gateway` cookie,
 * checked BEFORE login state. The cookie carries an opaque token; we store only
 * its HMAC and validate against `gateway_credentials`.
 *
 * Public (no gateway) routes: health/ready, the update manifest, the gateway
 * endpoints themselves, login and refresh (a user presents the passcode on
 * POST /gateway/verify which sets the cookie before they log in).
 */

const PUBLIC_PATTERNS: RegExp[] = [
  /^\/health$/,
  /^\/ready$/,
  /^\/api\/v1\/app\/update-manifest$/,
  /^\/api\/v1\/gateway\//,
  /^\/api\/v1\/setup\//,
  /^\/api\/v1\/auth\/login$/,
  /^\/api\/v1\/auth\/refresh$/,
]

function isPublic(path: string): boolean {
  return PUBLIC_PATTERNS.some((pattern) => pattern.test(path))
}

export const gatewayPlugin = fp(async (app: FastifyInstance): Promise<void> => {
  app.addHook('onRequest', async (request: FastifyRequest, _reply: FastifyReply) => {
    const path = request.url.split('?')[0] ?? '/'
    if (!path.startsWith('/api/v1/')) return
    if (isPublic(path)) return

    const gateway = await gatewayFromRequest(app, request)
    if (!gateway) {
      throw ApiError.unauthorized('gateway_required', '请先输入班级口令')
    }

    request.gateway = gateway
    request.gatewayVerified = true

    // Best-effort last-used bookkeeping; never block the request on it.
    void getPool()
      .query('UPDATE gateway_credentials SET last_used_at = now() WHERE id = $1', [gateway.credentialId])
      .catch(() => undefined)
  })
}, { name: 'wepov-gateway' })
