/**
 * Hierarchical token-bucket rate limiter (§15.3).
 *
 * Each tier enforces three windows simultaneously: 100ms, 1s and 60s. A request
 * must pass all three. Buckets are continuously refilled (token bucket), so a
 * 60-request burst in 10ms is rejected by the 100ms layer rather than waiting
 * for the minute to tick over.
 *
 * Tiers:
 * - account-read:  10 / 20 / 120
 * - account-write: 2 / 5 / 30
 * - login:         1 / 2 / (persistent failure lock handled separately)
 * - global:        32 / 100 / 3000
 * - trusted-ip:    40 / 200 / 3000 (loose; only when a trusted proxy is set)
 *
 * The limiter is per-process (in-memory), matching the single-instance deploy.
 */

export type TierName = 'account-read' | 'account-write' | 'login' | 'global' | 'trusted-ip'

interface TierLimits {
  per100ms: number
  per1s: number
  per60s: number
}

const TIER_LIMITS: Record<TierName, TierLimits> = {
  'account-read': { per100ms: 10, per1s: 20, per60s: 120 },
  'account-write': { per100ms: 2, per1s: 5, per60s: 30 },
  login: { per100ms: 1, per1s: 2, per60s: 6 },
  global: { per100ms: 32, per1s: 100, per60s: 3000 },
  'trusted-ip': { per100ms: 40, per1s: 200, per60s: 3000 },
}

const WINDOWS: Array<{ key: 'per100ms' | 'per1s' | 'per60s'; ms: number }> = [
  { key: 'per100ms', ms: 100 },
  { key: 'per1s', ms: 1000 },
  { key: 'per60s', ms: 60_000 },
]

interface Bucket {
  tokens: number
  capacity: number
  refillPerMs: number
  lastRefill: number
}

function makeBucket(capacity: number, windowMs: number, now: number): Bucket {
  return { tokens: capacity, capacity, refillPerMs: capacity / windowMs, lastRefill: now }
}

function take(bucket: Bucket, now: number): { ok: boolean; retryAfterMs: number } {
  const elapsed = now - bucket.lastRefill
  if (elapsed > 0) {
    bucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsed * bucket.refillPerMs)
    bucket.lastRefill = now
  }
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1
    return { ok: true, retryAfterMs: 0 }
  }
  const needed = 1 - bucket.tokens
  const retryAfterMs = Math.ceil(needed / bucket.refillPerMs)
  return { ok: false, retryAfterMs }
}

interface TierState {
  windows: Record<'per100ms' | 'per1s' | 'per60s', Bucket>
}

export interface RateDecision {
  allowed: boolean
  /** Milliseconds until the request would pass; drives Retry-After. */
  retryAfterMs: number
  /** Which window rejected it, for metrics. */
  limitedBy?: 'per100ms' | 'per1s' | 'per60s'
  tier: TierName
}

export interface RateLimiterOptions {
  now?: () => number
  limits?: Partial<Record<TierName, TierLimits>>
  /** Sweep idle keys after this long with no traffic. */
  idleEvictionMs?: number
}

export class RateLimiter {
  readonly #now: () => number
  readonly #limits: Record<TierName, TierLimits>
  readonly #idleEvictionMs: number
  readonly #buckets = new Map<string, { state: TierState; lastSeen: number }>()

  constructor(options: RateLimiterOptions = {}) {
    this.#now = options.now ?? (() => Date.now())
    this.#limits = { ...TIER_LIMITS, ...options.limits }
    this.#idleEvictionMs = options.idleEvictionMs ?? 10 * 60 * 1000
  }

  #stateFor(key: string, tier: TierName, now: number): TierState {
    const mapKey = `${tier}:${key}`
    let entry = this.#buckets.get(mapKey)
    if (!entry) {
      const limits = this.#limits[tier]
      entry = {
        state: {
          per100ms: makeBucket(limits.per100ms, 100, now),
          per1s: makeBucket(limits.per1s, 1000, now),
          per60s: makeBucket(limits.per60s, 60_000, now),
        },
        lastSeen: now,
      }
      this.#buckets.set(mapKey, entry)
    }
    entry.lastSeen = now
    return entry.state
  }

  /** Check (and consume) one unit for `key` in `tier`. */
  consume(tier: TierName, key: string): RateDecision {
    const now = this.#now()
    const state = this.#stateFor(key, tier, now)
    let worstRetry = 0
    let limitedBy: RateDecision['limitedBy']
    // Check all windows first without consuming, so a rejection in one window
    // does not drain the others.
    for (const window of WINDOWS) {
      const probe: Bucket = { ...state[window.key] }
      const result = take(probe, now)
      if (!result.ok) {
        if (result.retryAfterMs > worstRetry) {
          worstRetry = result.retryAfterMs
          limitedBy = window.key
        }
      }
    }
    if (limitedBy) {
      return { allowed: false, retryAfterMs: worstRetry, limitedBy, tier }
    }
    for (const window of WINDOWS) {
      take(state[window.key], now)
    }
    return { allowed: true, retryAfterMs: 0, tier }
  }

  /** Check all tiers for a request; returns the first failing decision. */
  consumeAll(checks: Array<{ tier: TierName; key: string }>): RateDecision {
    for (const check of checks) {
      const decision = this.consume(check.tier, check.key)
      if (!decision.allowed) return decision
    }
    return { allowed: true, retryAfterMs: 0, tier: checks[checks.length - 1]?.tier ?? 'global' }
  }

  /** Periodically call to drop idle keys and keep memory bounded. */
  sweep(): void {
    const now = this.#now()
    for (const [key, entry] of this.#buckets) {
      if (now - entry.lastSeen > this.#idleEvictionMs) {
        this.#buckets.delete(key)
      }
    }
  }

  get size(): number {
    return this.#buckets.size
  }
}

/** Format a Retry-After header value from milliseconds (seconds, min 1). */
export function retryAfterSeconds(retryAfterMs: number): number {
  return Math.max(1, Math.ceil(retryAfterMs / 1000))
}
