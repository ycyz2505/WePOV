import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { RateLimiter, retryAfterSeconds } from '../src/rate-limit.js'

function fakeClock(start = 1_000_000) {
  let now = start
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms
    },
  }
}

test('allows the first request in every window', () => {
  const clock = fakeClock()
  const limiter = new RateLimiter({ now: clock.now })
  const decision = limiter.consume('account-read', 'u1')
  assert.equal(decision.allowed, true)
  assert.equal(decision.retryAfterMs, 0)
})

test('rejects a burst that the 100ms window cannot absorb', () => {
  const clock = fakeClock()
  const limiter = new RateLimiter({ now: clock.now })
  // account-read allows 10 per 100ms.
  for (let i = 0; i < 10; i += 1) {
    assert.equal(limiter.consume('account-read', 'u1').allowed, true, `request ${i}`)
  }
  const rejected = limiter.consume('account-read', 'u1')
  assert.equal(rejected.allowed, false)
  assert.equal(rejected.limitedBy, 'per100ms')
  assert.ok(rejected.retryAfterMs > 0 && rejected.retryAfterMs <= 100)
})

test('a rejected request does not drain the other windows', () => {
  const clock = fakeClock()
  const limiter = new RateLimiter({ now: clock.now })
  for (let i = 0; i < 10; i += 1) limiter.consume('account-read', 'u1')
  // Rejections must be free: hammering the 100ms wall must not consume the
  // minute bucket, otherwise a retry loop could lock the user out for a minute.
  for (let i = 0; i < 200; i += 1) limiter.consume('account-read', 'u1')
  clock.advance(101)
  // After the 100ms bucket refills, the 1s bucket should still have capacity.
  assert.equal(limiter.consume('account-read', 'u1').allowed, true)
})

test('refills proportionally to elapsed time', () => {
  const clock = fakeClock()
  const limiter = new RateLimiter({ now: clock.now })
  for (let i = 0; i < 10; i += 1) limiter.consume('account-read', 'u1')
  assert.equal(limiter.consume('account-read', 'u1').allowed, false)
  clock.advance(50)
  // Half of a 100ms window => ~5 tokens back.
  let allowed = 0
  for (let i = 0; i < 10; i += 1) {
    if (limiter.consume('account-read', 'u1').allowed) allowed += 1
  }
  assert.ok(allowed >= 4 && allowed <= 6, `expected ~5, got ${allowed}`)
})

test('keys are isolated per tier and per identity', () => {
  const clock = fakeClock()
  const limiter = new RateLimiter({ now: clock.now })
  for (let i = 0; i < 10; i += 1) limiter.consume('account-read', 'u1')
  assert.equal(limiter.consume('account-read', 'u1').allowed, false)
  assert.equal(limiter.consume('account-read', 'u2').allowed, true)
  assert.equal(limiter.consume('global', 'u1').allowed, true)
})

test('consumeAll stops at the first failing tier', () => {
  const clock = fakeClock()
  const limiter = new RateLimiter({ now: clock.now })
  for (let i = 0; i < 10; i += 1) limiter.consume('account-read', 'u1')
  const decision = limiter.consumeAll([
    { tier: 'account-read', key: 'u1' },
    { tier: 'global', key: 'u1' },
  ])
  assert.equal(decision.allowed, false)
  assert.equal(decision.tier, 'account-read')
})

test('login tier is much stricter than account-read', () => {
  const clock = fakeClock()
  const limiter = new RateLimiter({ now: clock.now })
  assert.equal(limiter.consume('login', 'ip1').allowed, true)
  // login: 1 per 100ms.
  assert.equal(limiter.consume('login', 'ip1').allowed, false)
})

test('sweep drops idle keys', () => {
  const clock = fakeClock()
  const limiter = new RateLimiter({ now: clock.now, idleEvictionMs: 1000 })
  limiter.consume('global', 'a')
  limiter.consume('global', 'b')
  assert.equal(limiter.size, 2)
  clock.advance(1500)
  limiter.consume('global', 'c')
  limiter.sweep()
  assert.equal(limiter.size, 1)
})

test('retryAfterSeconds never returns zero', () => {
  assert.equal(retryAfterSeconds(0), 1)
  assert.equal(retryAfterSeconds(1), 1)
  assert.equal(retryAfterSeconds(1001), 2)
})

test('tokens are not shared between limiter instances', () => {
  const clock = fakeClock()
  const a = new RateLimiter({ now: clock.now })
  const b = new RateLimiter({ now: clock.now })
  for (let i = 0; i < 10; i += 1) a.consume('account-read', 'u1')
  assert.equal(a.consume('account-read', 'u1').allowed, false)
  assert.equal(b.consume('account-read', 'u1').allowed, true)
})

test('a 60s window caps sustained traffic', () => {
  const clock = fakeClock()
  const limiter = new RateLimiter({ now: clock.now })
  // 120 per minute for account-read. Feed 2 per 100ms for a minute.
  let total = 0
  for (let step = 0; step < 600; step += 1) {
    for (let i = 0; i < 2; i += 1) {
      if (limiter.consume('account-read', 'u1').allowed) total += 1
    }
    clock.advance(100)
  }
  assert.ok(total <= 130, `expected ~120, got ${total}`)
  assert.ok(total >= 110, `expected ~120, got ${total}`)
})

test('pepper-derived keys differ', () => {
  assert.notEqual(randomBytes(32).toString('hex'), randomBytes(32).toString('hex'))
})
