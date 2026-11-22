import type { FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import { retryAfterSeconds } from '@wepov/security'
import { ApiError } from '../errors.js'
import { sendRetryAfter } from '../lib/auth-guards.js'

/**
 * Global rate limiting + in-flight gate (§15.3).
 *
 * Ordering requirement: rate limiting must run BEFORE body parsing, password
 * hashing and DB queries. We register this as an onRequest hook, which runs
 * before the JSON body is parsed.
 *
 * Tiers:
 * - global (per process) for every API request
 * - trusted-ip (loose) only when TRUSTED_PROXY_HOPS > 0
 * - account-read / account-write per user (needs auth, so checked in a later
 *   hook after the auth plugin resolves the session)
 * - login per account, handled inside the login route
 *
 * The in-flight gate wraps every request; when saturated we fast-fail with 503
 * and Retry-After rather than queueing unboundedly.
 */

export const rateLimitPlugin = fp(async (app) => {
  // Static assets, the SPA document and health probes are not business traffic.
  const BYPASS_PREFIXES = ['/health', '/ready', '/api/v1/app/update-manifest']

  const isBusinessPath = (url: string): boolean =>
    url.startsWith('/api/v1/') && !BYPASS_PREFIXES.some((prefix) => url.startsWith(prefix))

  app.addHook('onRequest', async (request, reply) => {
    const url = request.url
    if (!isBusinessPath(url)) {
      return
    }

    // Global gate first.
    const globalDecision = app.rateLimiter.consume('global', 'global')
    if (!globalDecision.allowed) {
      sendRetryAfter(reply, retryAfterSeconds(globalDecision.retryAfterMs))
      throw ApiError.tooManyRequests('请求过于频繁，请稍后再试', retryAfterSeconds(globalDecision.retryAfterMs))
    }

    // Loose trusted-IP tier only when we actually know the client address.
    if (app.config.trustedProxyHops > 0 && request.ip) {
      const ipDecision = app.rateLimiter.consume('trusted-ip', request.ip)
      if (!ipDecision.allowed) {
        sendRetryAfter(reply, retryAfterSeconds(ipDecision.retryAfterMs))
        throw ApiError.tooManyRequests('请求过于频繁，请稍后再试', retryAfterSeconds(ipDecision.retryAfterMs))
      }
    }

    // The SSE stream is long-lived by design; it must not occupy one of the 24
    // in-flight slots or 60 subscribers would starve the whole API.
    if (url.startsWith('/api/v1/events')) return

    // In-flight gate.
    const entered = await app.inflight.tryEnter()
    if (!entered.ok) {
      sendRetryAfter(reply, Math.max(1, Math.ceil(entered.retryAfterMs / 1000)))
      if (entered.reason === 'queue_full') {
        throw ApiError.serviceUnavailable('服务繁忙，请稍后重试', Math.max(1, Math.ceil(entered.retryAfterMs / 1000)))
      }
      throw ApiError.serviceUnavailable('请求超时，请重试', Math.max(1, Math.ceil(entered.retryAfterMs / 1000)))
    }
    reply.raw.on('close', entered.release)
    reply.raw.on('finish', entered.release)
  })

  // Per-account tiers run after auth is resolved (onRequest auth plugin has
  // already run by the time this preHandler executes).
  app.addHook('preHandler', async (request: FastifyRequest, reply) => {
    const url = request.url
    if (!isBusinessPath(url)) return
    if (!request.auth) return
    // Login attempts are limited in the login route with the dedicated tier.
    if (url.includes('/auth/login')) return

    const isRead = request.method === 'GET' || request.method === 'HEAD'
    const tier = isRead ? 'account-read' : 'account-write'
    const decision = app.rateLimiter.consume(tier, request.auth.userId)
    if (!decision.allowed) {
      const seconds = retryAfterSeconds(decision.retryAfterMs)
      sendRetryAfter(reply, seconds)
      throw ApiError.tooManyRequests('操作过于频繁，请稍后再试', seconds)
    }
  })

  // Periodic sweep to keep the in-memory bucket map bounded.
  const sweepTimer = setInterval(() => app.rateLimiter.sweep(), 60_000)
  sweepTimer.unref?.()
  app.addHook('onClose', async () => {
    clearInterval(sweepTimer)
  })
}, { name: 'wepov-rate-limit' })
