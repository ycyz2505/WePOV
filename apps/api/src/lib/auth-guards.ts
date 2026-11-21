import type { FastifyReply, FastifyRequest } from 'fastify'
import { ApiError } from '../errors.js'

/** Throw 401 unless the request carries a valid session. */
export function requireAuth(request: FastifyRequest): NonNullable<FastifyRequest['auth']> {
  if (!request.auth) {
    throw ApiError.unauthorized()
  }
  return request.auth
}

/** Throw 401 if not authenticated, then 403 unless the caller holds `perm`. */
export function requirePermission(
  request: FastifyRequest,
  role: string,
  allowedRoles: readonly string[],
): void {
  if (!allowedRoles.includes(role)) {
    throw ApiError.forbidden('insufficient_role', '当前角色无权执行此操作')
  }
}

/** Parse an Idempotency-Key header, if present. */
export function idempotencyKey(request: FastifyRequest): string | null {
  const value = request.headers['idempotency-key']
  if (typeof value === 'string' && value.length > 0 && value.length <= 200) return value
  return null
}

/** Extract the client IP honouring trusted proxy hops, or null. */
export function clientIp(request: FastifyRequest): string | null {
  const hops = request.server.config.trustedProxyHops
  if (hops > 0) {
    const forwarded = request.headers['x-forwarded-for']
    const raw = Array.isArray(forwarded) ? forwarded.join(',') : forwarded
    if (raw) {
      const parts = raw.split(',').map((p) => p.trim()).filter(Boolean)
      // The right-most `hops` entries are our own proxies; the client is just
      // before them. With 1 hop (Altare edge), the client is the last entry.
      const idx = parts.length - hops
      const candidate = parts[idx]
      if (candidate) return candidate
    }
  }
  return request.ip ?? null
}

export function sendRetryAfter(reply: FastifyReply, seconds: number): void {
  reply.header('Retry-After', String(Math.max(1, Math.ceil(seconds))))
}
