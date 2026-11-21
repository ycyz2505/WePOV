export { loadSecurityConfig, type SecurityConfig, type SecurityEnv } from './config.js'
export { Keyring, isSealedValue, type SealedValue } from './encryption.js'
export { hmacHex, hmacBuffer, safeEqualHex, safeEqualString } from './hmac.js'
export { CountingSemaphore, SemaphoreTimeoutError, withSemaphore, type Semaphore } from './concurrency.js'
export {
  ARGON2_OPTIONS,
  argonGate,
  hashPassword,
  verifyContainedPassword,
  verifyExactPassword,
  findContainedCandidate,
  makeMatchTag,
  type PasswordRecord,
  type ContainedVerifyResult,
} from './password.js'
export {
  newOpaqueToken,
  hashToken,
  issueToken,
  sha256Hex,
  hashGatewayPasscode,
  newRecoveryCode,
  newInitialPassword,
  type IssuedToken,
} from './tokens.js'
export {
  SessionManager,
  PERSISTENT_IDLE_MS,
  PERSISTENT_ABSOLUTE_MS,
  type SessionStore,
  type SessionRecord,
  type SessionIssue,
  type SessionMode,
  type CreateSessionInput,
} from './sessions.js'
export {
  RateLimiter,
  retryAfterSeconds,
  type TierName,
  type RateDecision,
  type RateLimiterOptions,
} from './rate-limit.js'
export { InflightGate, type InflightResult, type InflightOptions } from './inflight.js'
export { writeAudit, AuditError, type AuditEntry, type AuditQuery } from './audit.js'
export {
  LoginFailureTracker,
  evaluateLock,
  MAX_LOGIN_FAILURES,
  LOCK_DURATION_MS,
  type LoginFailureStore,
  type LoginFailureState,
  type LoginLockDecision,
} from './login-lock.js'
export {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  hasPermission,
  isAdmin,
  assertPermission,
  AuthorizationError,
  type Role,
  type Permission,
} from './permissions.js'
