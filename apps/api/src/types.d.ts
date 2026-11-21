import type { AppConfig } from './config.js'
import type { U3Client } from './lib/u3.js'
import type { SessionManager, RateLimiter, InflightGate, LoginFailureTracker, Role } from '@wepov/security'
import type { NotificationBus } from './lib/notification-bus.js'

/**
 * Request-scoped authentication context. Populated by the auth plugin after it
 * resolves the bearer token (or persistent refresh cookie) to a session.
 */
export interface AuthContext {
  userId: string
  classId: string
  sessionId: string
  familyId: string
  deviceId: string
  mode: 'temporary' | 'persistent'
  role: Role
  nickname: string
  realName: string
  gender: string
  avatarObjectKey: string | null
  mustChangePassword: boolean
  idleTimeoutMinutes: number
  /** When set and in the future, the member is muted (§6.3). */
  mutedUntil: Date | null
}

/** Resolved class-gateway admission from the `wepov_gateway` cookie. */
export interface GatewayContext {
  classId: string
  credentialId: string
  remember: boolean
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null
    /** Gateway admission (class passcode) resolved from the cookie. */
    gateway: GatewayContext | null
    gatewayVerified: boolean
    /** HMAC of the client IP for log correlation and abuse pseudonyms. */
    ipHmac: string | null
  }

  interface FastifyInstance {
    config: AppConfig
    u3: U3Client
    sessions: SessionManager
    rateLimiter: RateLimiter
    inflight: InflightGate
    loginFailures: LoginFailureTracker
    notifications: NotificationBus
    requireAuth: (request: FastifyRequest) => AuthContext
    hasPermission: (request: FastifyRequest, permission: string) => boolean
  }
}

export {}
