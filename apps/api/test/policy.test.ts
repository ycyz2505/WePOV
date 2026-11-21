import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, validationError } from '../src/errors.js'
import { loadVersionPolicy, invalidateVersionPolicy } from '../src/lib/policy.js'

function fakeApp() {
  return { config: { minAppVersionCode: 5 } } as unknown as Parameters<typeof loadVersionPolicy>[0]
}

test('ApiError carries a status, code and message', () => {
  const error = new ApiError(418, 'teapot', '短而胖')
  assert.equal(error.statusCode, 418)
  assert.equal(error.code, 'teapot')
  assert.equal(error.message, '短而胖')
  assert.equal(error.retryAfterSeconds, null)
})

test('rate-limit errors always carry a retry hint', () => {
  const limited = ApiError.tooManyRequests('太快了', 3)
  assert.equal(limited.statusCode, 429)
  assert.equal(limited.retryAfterSeconds, 3)
  const unavailable = ApiError.serviceUnavailable('稍后再试', 5)
  assert.equal(unavailable.statusCode, 503)
  assert.equal(unavailable.retryAfterSeconds, 5)
})

test('the upgrade error is 426 and embeds the policy', () => {
  const error = ApiError.upgradeRequired('需要更新', { minSupportedVersionCode: 9 })
  assert.equal(error.statusCode, 426)
  assert.equal(error.code, 'app_version_unsupported')
  assert.deepEqual(error.details, { minSupportedVersionCode: 9 })
})

test('validationError is a 400 with details', () => {
  const error = validationError([{ path: ['nickname'], message: '太长' }])
  assert.equal(error.statusCode, 400)
  assert.equal(error.code, 'validation_error')
  assert.ok(Array.isArray(error.details))
})

test('the version policy falls back to config when the database is unreachable', async () => {
  invalidateVersionPolicy()
  const saved = process.env['DATABASE_URL']
  delete process.env['DATABASE_URL']
  try {
    const policy = await loadVersionPolicy(fakeApp())
    assert.equal(policy.minSupportedVersionCode, 5)
    assert.equal(policy.latestVersionCode, 0)
    assert.equal(policy.notes, '')
  } finally {
    if (saved !== undefined) process.env['DATABASE_URL'] = saved
    invalidateVersionPolicy()
  }
})

test('a failed policy load is not cached, so a recovered database is picked up', async () => {
  invalidateVersionPolicy()
  const saved = process.env['DATABASE_URL']
  delete process.env['DATABASE_URL']
  try {
    const app = fakeApp()
    const first = await loadVersionPolicy(app)
    assert.equal(first.minSupportedVersionCode, 5)
    const mutable = app as unknown as { config: { minAppVersionCode: number } }
    mutable.config.minAppVersionCode = 99
    const second = await loadVersionPolicy(app)
    assert.equal(second.minSupportedVersionCode, 99, 'config fallback must not be cached')
  } finally {
    if (saved !== undefined) process.env['DATABASE_URL'] = saved
    invalidateVersionPolicy()
  }
})
