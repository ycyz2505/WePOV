import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CountingSemaphore, SemaphoreTimeoutError } from '../src/concurrency.js'
import { InflightGate } from '../src/inflight.js'
import { evaluateLock, LoginFailureTracker, MAX_LOGIN_FAILURES, type LoginFailureStore, type LoginFailureState } from '../src/login-lock.js'

test('semaphore admits up to its limit', async () => {
  const sem = new CountingSemaphore(2)
  const r1 = await sem.acquire()
  const r2 = await sem.acquire()
  assert.equal(sem.active, 2)
  const pending = sem.acquire()
  assert.equal(sem.waiting, 1)
  r1()
  await pending
  assert.equal(sem.active, 2)
  r2()
})

test('release is idempotent', async () => {
  const sem = new CountingSemaphore(1)
  const release = await sem.acquire()
  release()
  release()
  assert.equal(sem.active, 0)
  await sem.acquire()
})

test('acquire honours maxWaitMs', async () => {
  const sem = new CountingSemaphore(1)
  const held = await sem.acquire()
  await assert.rejects(() => sem.acquire(10), SemaphoreTimeoutError)
  held()
})

test('semaphore rejects a bad limit', () => {
  assert.throws(() => new CountingSemaphore(0))
})

test('inflight admits up to maxConcurrent', async () => {
  const gate = new InflightGate({ maxConcurrent: 2, queueSize: 2 })
  const a = await gate.tryEnter()
  const b = await gate.tryEnter()
  assert.equal(a.ok && b.ok, true)
  if (a.ok) a.release()
  if (b.ok) b.release()
})

test('inflight fast-fails when the queue is full', async () => {
  const gate = new InflightGate({ maxConcurrent: 1, queueSize: 1, maxWaitMs: 500 })
  const held = await gate.tryEnter()
  assert.equal(held.ok, true)
  const queued = gate.tryEnter()
  const overflow = await gate.tryEnter()
  assert.equal(overflow.ok, false)
  if (!overflow.ok) assert.equal(overflow.reason, 'queue_full')
  if (held.ok) held.release()
  const queuedResult = await queued
  if (queuedResult.ok) queuedResult.release()
})

test('inflight times out a queued request', async () => {
  const gate = new InflightGate({ maxConcurrent: 1, queueSize: 4, maxWaitMs: 10 })
  const held = await gate.tryEnter()
  const result = await gate.tryEnter()
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.reason, 'timeout')
  if (held.ok) held.release()
})

test('inflight hands a slot to the next waiter', async () => {
  const gate = new InflightGate({ maxConcurrent: 1, queueSize: 4, maxWaitMs: 1000 })
  const first = await gate.tryEnter()
  const second = gate.tryEnter()
  if (first.ok) first.release()
  const secondResult = await second
  assert.equal(secondResult.ok, true)
  if (secondResult.ok) secondResult.release()
})

test('evaluateLock reports an active lock', () => {
  const now = new Date('2026-01-01T00:00:00Z')
  const lockedUntil = new Date(now.getTime() + 60_000)
  const decision = evaluateLock({ failedCount: 5, lockedUntil }, now)
  assert.equal(decision.locked, true)
  assert.equal(decision.retryAfterSeconds, 60)
})

test('evaluateLock ignores an expired lock', () => {
  const now = new Date('2026-01-01T00:00:00Z')
  const lockedUntil = new Date(now.getTime() - 1)
  assert.equal(evaluateLock({ failedCount: 5, lockedUntil }, now).locked, false)
})

class MemoryStore implements LoginFailureStore {
  readonly rows = new Map<string, LoginFailureState>()
  async get(userId: string): Promise<LoginFailureState> {
    return this.rows.get(userId) ?? { failedCount: 0, lockedUntil: null }
  }
  async recordFailure(userId: string, state: LoginFailureState): Promise<void> {
    this.rows.set(userId, state)
  }
  async clear(userId: string): Promise<void> {
    this.rows.delete(userId)
  }
}

test('the account locks after the configured number of failures', async () => {
  const store = new MemoryStore()
  const tracker = new LoginFailureTracker(store)
  const now = new Date('2026-01-01T00:00:00Z')
  for (let i = 1; i < MAX_LOGIN_FAILURES; i += 1) {
    const decision = await tracker.recordFailure('u1', now)
    assert.equal(decision.locked, false, `after ${i} failures`)
  }
  const locked = await tracker.recordFailure('u1', now)
  assert.equal(locked.locked, true)
  assert.ok(locked.retryAfterSeconds > 0)
})

test('a successful login clears the counter', async () => {
  const store = new MemoryStore()
  const tracker = new LoginFailureTracker(store)
  const now = new Date('2026-01-01T00:00:00Z')
  await tracker.recordFailure('u1', now)
  await tracker.clear('u1')
  assert.equal((await tracker.check('u1', now)).locked, false)
})

test('an expired lock resets the counter', async () => {
  const store = new MemoryStore()
  const tracker = new LoginFailureTracker(store)
  const now = new Date('2026-01-01T00:00:00Z')
  for (let i = 0; i < MAX_LOGIN_FAILURES; i += 1) await tracker.recordFailure('u1', now)
  const later = new Date(now.getTime() + 20 * 60 * 1000)
  const decision = await tracker.recordFailure('u1', later)
  assert.equal(decision.locked, false)
})
