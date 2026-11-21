/**
 * Persistent login-failure lock (§15.3): 5 failures lock the account for 15 min.
 *
 * The store is abstracted; the API provides a Postgres-backed implementation
 * against `login_failures`. On success the counter is cleared.
 */

export const MAX_LOGIN_FAILURES = 5
export const LOCK_DURATION_MS = 15 * 60 * 1000

export interface LoginFailureState {
  failedCount: number
  lockedUntil: Date | null
}

export interface LoginFailureStore {
  get(userId: string): Promise<LoginFailureState>
  recordFailure(userId: string, state: LoginFailureState): Promise<void>
  clear(userId: string): Promise<void>
}

export interface LoginLockDecision {
  locked: boolean
  /** Seconds remaining when locked. */
  retryAfterSeconds: number
}

export function evaluateLock(state: LoginFailureState, now: Date = new Date()): LoginLockDecision {
  if (state.lockedUntil && state.lockedUntil.getTime() > now.getTime()) {
    return {
      locked: true,
      retryAfterSeconds: Math.max(1, Math.ceil((state.lockedUntil.getTime() - now.getTime()) / 1000)),
    }
  }
  return { locked: false, retryAfterSeconds: 0 }
}

export class LoginFailureTracker {
  readonly #store: LoginFailureStore

  constructor(store: LoginFailureStore) {
    this.#store = store
  }

  async check(userId: string, now: Date = new Date()): Promise<LoginLockDecision> {
    const state = await this.#store.get(userId)
    return evaluateLock(state, now)
  }

  /** Record a failed attempt; returns the new lock decision. */
  async recordFailure(userId: string, now: Date = new Date()): Promise<LoginLockDecision> {
    const state = await this.#store.get(userId)
    // If a previous lock has expired, reset the counter.
    const base = state.lockedUntil && state.lockedUntil.getTime() <= now.getTime() ? 0 : state.failedCount
    const failedCount = base + 1
    const lockedUntil =
      failedCount >= MAX_LOGIN_FAILURES ? new Date(now.getTime() + LOCK_DURATION_MS) : state.lockedUntil
    await this.#store.recordFailure(userId, { failedCount, lockedUntil })
    return evaluateLock({ failedCount, lockedUntil }, now)
  }

  async clear(userId: string): Promise<void> {
    await this.#store.clear(userId)
  }
}
