import type { FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import { randomUUID } from 'node:crypto'
import { clientIp } from '../lib/auth-guards.js'
import { encryptLogFields, recordRequestLog } from '../lib/telemetry.js'

/**
 * Request context plugin: request id, security headers, structured access log
 * (never logging secrets), and the compact request-log index write (§14.2).
 *
 * We deliberately do NOT log request bodies, authorization, cookies, or tree
 * content. Route templates are logged instead of raw URLs.
 */

export const requestContextPlugin = fp(async (app) => {
  app.addHook('onRequest', async (request, reply) => {
    const incoming = request.headers['x-request-id']
    const requestId =
      typeof incoming === 'string' && incoming.length > 0 && incoming.length <= 80 ? incoming : randomUUID()
    const extended = request as FastifyRequest & { requestId: string; startTime: number }
    extended.requestId = requestId
    extended.startTime = Date.now()
    reply.header('x-request-id', requestId)
  })

  app.addHook('onSend', async (request, reply, payload) => {
    // Security headers (§15.1).
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Referrer-Policy', 'no-referrer')
    reply.header('Cross-Origin-Opener-Policy', 'same-origin')
    reply.header('Cross-Origin-Resource-Policy', 'same-origin')
    reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
    if (app.config.isProduction) {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    }
    // JSON API responses can never render HTML. The static document sets its
    // own CSP in index.ts, so we only lock down API and probe paths here.
    const path = request.url.split('?')[0] ?? '/'
    if (path.startsWith('/api/') || path === '/health' || path === '/ready') {
      reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
    }
    return payload
  })

  app.addHook('onResponse', async (request, reply) => {
    const startedAt = (request as FastifyRequest & { startTime?: number }).startTime ?? Date.now()
    const durationMs = Date.now() - startedAt
    const route = request.routeOptions.url ?? request.url.split('?')[0] ?? '/'
    const requestId = (request as FastifyRequest & { requestId?: string }).requestId ?? ''

    const statusCode = reply.statusCode
    const auth = request.auth
    const ip = clientIp(request)
    const ua = request.headers['user-agent'] ?? null
    const { ipEnc, userAgentEnc } = encryptLogFields(app.config, ip, ua)

    // Structured stdout log — no secrets, no bodies.
    request.log.info({
      requestId,
      method: request.method,
      route,
      statusCode,
      durationMs,
      userId: auth?.userId ?? null,
      ipHmac: request.ipHmac,
    })

    if (!app.config.isProduction && route.startsWith('/health')) return

    await recordRequestLog({
      requestId,
      classId: auth?.classId ?? null,
      route,
      method: request.method,
      statusCode,
      durationMs,
      responseBytes: Number(reply.getHeader('content-length') ?? 0) || 0,
      userHmac: request.ipHmac ? auth?.userId ?? null : null,
      sessionHmac: auth?.sessionId ?? null,
      deviceHmac: auth?.deviceId ?? null,
      ipEnc,
      userAgentEnc,
      ipHmac: request.ipHmac,
      rateLimited: statusCode === 429,
      timedOut: statusCode === 503,
      errorClass: statusCode >= 500 ? 'server' : statusCode >= 400 ? 'client' : null,
      deployVersion: process.env['ALTARE_DEPLOY'] ?? process.env['ALTARE_GIT_COMMIT_SHA'] ?? null,
    })
  })
}, { name: 'wepov-request-context' })
