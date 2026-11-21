import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { loadSecurityConfig } from '../src/config.js'
import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  hasPermission,
  isAdmin,
  assertPermission,
  AuthorizationError,
  type Role,
} from '../src/permissions.js'

test('SESSION_PEPPER is mandatory', () => {
  assert.throws(() => loadSecurityConfig({}), /SESSION_PEPPER is required/)
})

test('a short pepper is rejected', () => {
  assert.throws(() => loadSecurityConfig({ SESSION_PEPPER: 'short' }), /at least 16 characters/)
})

test('missing keys are derived and reported', () => {
  const config = loadSecurityConfig({ SESSION_PEPPER: 'a'.repeat(32) })
  assert.deepEqual(
    config.derivedKeys.sort(),
    ['ABUSE_HMAC_KEY', 'DATA_ENCRYPTION_KEY', 'LOG_IP_HMAC_KEY', 'PASSWORD_MATCH_KEY', 'TREE_IDENTITY_HMAC_KEY'].sort(),
  )
  assert.equal(config.sessionPepper.length, 32)
  assert.equal(config.encryption.currentVersion, 1)
})

test('derived keys are independent', () => {
  const config = loadSecurityConfig({ SESSION_PEPPER: 'a'.repeat(32) })
  const seen = new Set([
    config.passwordMatchKey.toString('hex'),
    config.abuseKey.toString('hex'),
    config.logIpKey.toString('hex'),
    config.treeIdentityKey.toString('hex'),
  ])
  assert.equal(seen.size, 4)
  assert.equal(config.encryption.currentVersion, 1)
})

test('explicit keys are used verbatim (hashed)', () => {
  const config = loadSecurityConfig({
    SESSION_PEPPER: 'a'.repeat(32),
    PASSWORD_MATCH_KEY: 'b'.repeat(32),
    TREE_IDENTITY_HMAC_KEY: 'c'.repeat(32),
  })
  assert.ok(!config.derivedKeys.includes('PASSWORD_MATCH_KEY'))
  assert.ok(!config.derivedKeys.includes('TREE_IDENTITY_HMAC_KEY'))
  assert.ok(config.derivedKeys.includes('ABUSE_HMAC_KEY'))
})

test('a base64 encryption key must decode to 32 bytes', () => {
  const good = randomBytes(32).toString('base64')
  const config = loadSecurityConfig({ SESSION_PEPPER: 'a'.repeat(32), DATA_ENCRYPTION_KEY: good })
  assert.ok(!config.derivedKeys.includes('DATA_ENCRYPTION_KEY'))
  assert.throws(
    () => loadSecurityConfig({ SESSION_PEPPER: 'a'.repeat(32), DATA_ENCRYPTION_KEY: randomBytes(16).toString('base64') }),
    /exactly 32 bytes/,
  )
})

test('key rotation keeps the previous key available', () => {
  const config = loadSecurityConfig({
    SESSION_PEPPER: 'a'.repeat(32),
    DATA_ENCRYPTION_KEY_VERSION: '2',
    DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    DATA_ENCRYPTION_KEY_PREVIOUS: randomBytes(32).toString('base64'),
  })
  assert.equal(config.encryption.currentVersion, 2)
  assert.equal(config.encryption.has(1), true)
  assert.equal(config.encryption.has(2), true)
})

test('an invalid key version is rejected', () => {
  assert.throws(
    () => loadSecurityConfig({ SESSION_PEPPER: 'a'.repeat(32), DATA_ENCRYPTION_KEY_VERSION: '0' }),
    /positive integer/,
  )
})

test('students hold no permissions', () => {
  assert.equal(ROLE_PERMISSIONS.student.length, 0)
  assert.equal(isAdmin('student'), false)
  for (const permission of Object.values(PERMISSIONS)) {
    assert.equal(hasPermission('student', permission), false)
  }
})

test('general admins can moderate and review albums only', () => {
  assert.deepEqual([...ROLE_PERMISSIONS.general_admin].sort(), [PERMISSIONS.albumReview, PERMISSIONS.moderation].sort())
  assert.equal(hasPermission('general_admin', PERMISSIONS.treeRevealIdentity), false)
  assert.equal(hasPermission('general_admin', PERMISSIONS.logsRead), false)
  assert.equal(isAdmin('general_admin'), true)
})

test('super admins hold every permission', () => {
  for (const permission of Object.values(PERMISSIONS)) {
    assert.equal(hasPermission('super_admin', permission), true, permission)
  }
})

test('assertPermission throws an AuthorizationError with the permission', () => {
  assert.throws(
    () => assertPermission('student' as Role, PERMISSIONS.logsRead),
    (error: unknown) => error instanceof AuthorizationError && error.permission === PERMISSIONS.logsRead,
  )
  assert.doesNotThrow(() => assertPermission('super_admin', PERMISSIONS.logsRead))
})
