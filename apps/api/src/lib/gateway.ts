import type { FastifyInstance, FastifyRequest } from 'fastify'
import { getPool } from '@wepov/database'
import { hashToken } from '@wepov/security'
import { GATEWAY_COOKIE, readCookie } from './cookies.js'
import type { GatewayContext } from '../types.js'

/**
 * Class-gateway resolution. The cookie carries an opaque token; only its HMAC
 * is stored in `gateway_credentials`. Shared by the onRequest guard and by the
 * gateway routes that read the cookie directly.
 */

interface GatewayRow {
  id: string
  class_id: string
  remember: boolean
}

export async function resolveGatewayToken(
  app: FastifyInstance,
  token: string,
): Promise<GatewayContext | null> {
  const hash = hashToken(app.config.security.sessionPepper, 'gateway', token)
  const result = await getPool().query<GatewayRow>(
    `SELECT id, class_id, remember FROM gateway_credentials
      WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [hash],
  )
  const row = result.rows[0]
  if (!row) return null
  return { classId: row.class_id, credentialId: row.id, remember: row.remember }
}

export async function gatewayFromRequest(
  app: FastifyInstance,
  request: FastifyRequest,
): Promise<GatewayContext | null> {
  const token = readCookie(request, GATEWAY_COOKIE)
  if (!token) return null
  return resolveGatewayToken(app, token)
}
