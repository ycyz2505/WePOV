import type { FastifyReply, FastifyRequest } from 'fastify'

/**
 * Cookie contract (coordinator). The frontend never reads these values; they
 * are HttpOnly. Two cookies exist:
 *
 * - wepov_gateway: class passcode admission. Session cookie when the user did
 *   not choose "remember"; 90-day cookie when they did.
 * - wepov_refresh: persistent login refresh credential used by /auth/refresh
 *   and the SSE stream. Only set for mode=persistent.
 */

export const GATEWAY_COOKIE = 'wepov_gateway'
export const REFRESH_COOKIE = 'wepov_refresh'
/** Access token in an HttpOnly cookie so `EventSource` can authenticate (§12). */
export const STREAM_COOKIE = 'wepov_stream'

export const REMEMBER_DAYS = 90
export const REFRESH_MAX_AGE_SECONDS = 90 * 24 * 60 * 60

export interface CookieConfig {
  secure: boolean
}

function base(secure: boolean): {
  httpOnly: true
  sameSite: 'strict'
  secure: boolean
  path: string
} {
  return { httpOnly: true, sameSite: 'strict', secure, path: '/' }
}

export function setGatewayCookie(
  reply: FastifyReply,
  config: CookieConfig,
  token: string,
  rememberDevice: boolean,
  ttlSeconds: number,
): void {
  if (rememberDevice) {
    reply.setCookie(GATEWAY_COOKIE, token, { ...base(config.secure), maxAge: ttlSeconds })
  } else {
    // Session cookie: no Max-Age so it disappears when the browser closes.
    reply.setCookie(GATEWAY_COOKIE, token, base(config.secure))
  }
}

export function clearGatewayCookie(reply: FastifyReply, config: CookieConfig): void {
  reply.clearCookie(GATEWAY_COOKIE, base(config.secure))
}

export function setRefreshCookie(reply: FastifyReply, config: CookieConfig, token: string): void {
  reply.setCookie(REFRESH_COOKIE, token, {
    ...base(config.secure),
    maxAge: REFRESH_MAX_AGE_SECONDS,
  })
}

export function clearRefreshCookie(reply: FastifyReply, config: CookieConfig): void {
  reply.clearCookie(REFRESH_COOKIE, base(config.secure))
}

export function setStreamCookie(
  reply: FastifyReply,
  config: CookieConfig,
  token: string,
  ttlSeconds: number,
): void {
  reply.setCookie(STREAM_COOKIE, token, { ...base(config.secure), maxAge: ttlSeconds })
}

export function clearStreamCookie(reply: FastifyReply, config: CookieConfig): void {
  reply.clearCookie(STREAM_COOKIE, base(config.secure))
}

export function readCookie(request: FastifyRequest, name: string): string | null {
  const value = request.cookies[name]
  return typeof value === 'string' && value.length > 0 ? value : null
}
