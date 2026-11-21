/**
 * Hierarchical rate limiting (§15.3).
 *
 * Every request must pass three windows at once: 100ms, 1s and 60s.
 *
 * - The two short windows are continuous token buckets: a burst of 10 reads in
 *   one 100ms still passes, and tokens refill proportionally with elapsed time.
 *   This avoids punishing a person who taps through ten photos quickly.
 * - The 60s window is a sliding-window counter: no 60-second span may contain
 *   more than the configured number of requests. A token bucket here would let
 *   a client spend the full bucket *and* the minute's refill (2× the limit).
 *
 * Tiers:
 * - account-read:  10 / 20 / 120
 * - account-write: 2 / 5 / 30
 * - login:         1 / 2 / 6
 * - global:        32 / 100 / 3000
 * - trusted-ip:    40 / 200 / 3000 (loose; only with a trusted proxy)
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

type WindowKey = keyof TierLimits

interface TokenBucket {
  tokens: number
  capacity: number
  refillPerMs: number
  lastRefill: number
}

interface WindowCount {
  /** Timestamps (ms) of accepted requests, oldest first. */
  hits: number[]
  capacity: number
  windowMs: number
}

interface TierState {
  per100ms: TokenBucket
  per1s: TokenBucket
  per60s: WindowCount
}

function makeTokenBucket(capacity: number, windowMs: number, now: number): TokenBucket {
  return { tokens: capacity, capacity, refillPerMs: capacity / windowMs, lastRefill: now }
}

function tokenPreview(bucket: TokenBucket, now: number): { ok: boolean; retryAfterMs: number } {
  const elapsed = now - bucket.lastRefill
  const tokens = elapsed > 0
    ? Math.min(bucket.capacity, bucket.tokens + elapsed * bucket.refillPerMs)
    : bucket.tokens
  if (tokens >= 1) return { ok: true, retryAfterMs: 0 }
  return { ok: false, retryAfterMs: Math.ceil((1 - tokens) / bucket.refillPerMs) }
}

function tokenConsume(bucket: TokenBucket, now: number): void {
  const elapsed = now - bucket.lastRefill
  if (elapsed > 0) {
    bucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsed * bucket.refillPerMs)
    bucket.lastRefill = now
  }
  bucket.tokens -= 1
}

function windowPreview(bucket: WindowCount, now: number): { ok: boolean; retryAfterMs: number } {
  const cutoff = now - bucket.windowMs
  let live = 0
  for (let i = bucket.hits.length - 1; i >= 0; i -= 1) {
    if (bucket.hits[i]! > cutoff) live += 1
    else break
  }
  if (live < bucket.capacity) return { ok: true, retryAfterMs: 0 }
  const oldestLive = bucket.hits[bucket.hits.length - live]!
  return { ok: false, retryAfterMs: Math.max(1, oldestLive + bucket.windowMs - now) }
}

function windowConsume(bucket: WindowCount, now: number): void {
  const cutoff = now - bucket.windowMs
  let drop = 0
  while (drop < bucket.hits.length && bucket.hits[drop]! <= cutoff) drop += 1
  if (drop > 0) bucket.hits.splice(0, drop)
  bucket.hits.push(now)
}

export interface RateDecision {
  allowed: boolean
  /** Milliseconds until the request would pass; drives Retry-After. */
  retryAfterMs: number
  /** Which window rejected it, for metrics. */
  limitedBy?: WindowKey
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
    const existing = this.#buckets.get(mapKey)
    if (existing) {
      existing.lastSeen = now
      return existing.state
    }
    const limits = this.#limits[tier]
    const state: TierState = {
      per100ms: makeTokenBucket(limits.per100ms, 100, now),
      per1s: makeTokenBucket(limits.per1s, 1000, now),
      per60s: { hits: [], capacity: limits.per60s, windowMs: 60_000 },
    }
    this.#buckets.set(mapKey, { state, lastSeen: now })
    return state
  }

  /** Check (and consume) one unit for `key` in `tier`. */
  consume(tier: TierName, key: string): RateDecision {
    const now = this.#now()
    const state = this.#stateFor(key, tier, now)

    // Check every window before consuming, so a rejection in one window does
    // not drain the others (otherwise a retry loop could lock the user out of
    // the minute bucket just by hammering the 100ms wall).
    const short100 = tokenPreview(state.per100ms, now)
    const short1s = tokenPreview(state.per1s, now)
    const long60 = windowPreview(state.per60s, now)

    let worstRetry = 0
    let limitedBy: WindowKey | undefined
    const consider = (key: WindowKey, result: { ok: boolean; retryAfterMs: number }): void => {
      if (!result.ok && result.retryAfterMs > worstRetry) {
        worstRetry = result.retryAfterMs
        limitedBy = key
      }
    }
    consider('per100ms', short100)
    consider('per1s', short1s)
    consider('per60s', long60)

    if (limitedBy) {
      return { allowed: false, retryAfterMs: worstRetry, limitedBy, tier }
    }

    tokenConsume(state.per100ms, now)
    tokenConsume(state.per1s, now)
    windowConsume(state.per60s, now)
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
