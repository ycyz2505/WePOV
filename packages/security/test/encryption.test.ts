import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { Keyring, isSealedValue } from '../src/encryption.js'

const aad = 'tree_post:00000000-0000-0000-0000-000000000001:author'

test('seal/open round-trips a string', () => {
  const ring = new Keyring(new Map([[1, randomBytes(32)]]), 1)
  const sealed = ring.seal('许亦舟', aad)
  assert.equal(ring.openString(sealed, aad), '许亦舟')
})

test('seal/open round-trips a buffer', () => {
  const ring = new Keyring(new Map([[1, randomBytes(32)]]), 1)
  const payload = randomBytes(1024)
  const sealed = ring.seal(payload, aad)
  assert.deepEqual(ring.open(sealed, aad), payload)
})

test('every seal uses a fresh nonce', () => {
  const ring = new Keyring(new Map([[1, randomBytes(32)]]), 1)
  const seen = new Set<string>()
  for (let i = 0; i < 200; i += 1) {
    const sealed = ring.seal('same plaintext', aad)
    assert.equal(Buffer.from(sealed.iv, 'base64').length, 12)
    assert.ok(!seen.has(sealed.iv), 'nonce reused')
    seen.add(sealed.iv)
  }
})

test('same plaintext yields different ciphertext', () => {
  const ring = new Keyring(new Map([[1, randomBytes(32)]]), 1)
  const a = ring.seal('x', aad)
  const b = ring.seal('x', aad)
  assert.notEqual(a.ct, b.ct)
})

test('a different AAD fails to open', () => {
  const ring = new Keyring(new Map([[1, randomBytes(32)]]), 1)
  const sealed = ring.seal('secret', aad)
  assert.throws(() => ring.open(sealed, 'tree_post:other:author'))
})

test('tampered ciphertext fails to open', () => {
  const ring = new Keyring(new Map([[1, randomBytes(32)]]), 1)
  const sealed = ring.seal('secret', aad)
  const bytes = Buffer.from(sealed.ct, 'base64')
  bytes[0] = bytes[0]! ^ 0xff
  assert.throws(() => ring.open({ ...sealed, ct: bytes.toString('base64') }, aad))
})

test('tampered tag fails to open', () => {
  const ring = new Keyring(new Map([[1, randomBytes(32)]]), 1)
  const sealed = ring.seal('secret', aad)
  const tag = Buffer.from(sealed.tag, 'base64')
  tag[0] = tag[0]! ^ 0x01
  assert.throws(() => ring.open({ ...sealed, tag: tag.toString('base64') }, aad))
})

test('an unknown key version fails to open', () => {
  const ring = new Keyring(new Map([[1, randomBytes(32)]]), 1)
  const sealed = ring.seal('secret', aad)
  assert.throws(() => ring.open({ ...sealed, v: 9 }, aad))
})

test('old keys still decrypt after rotation', () => {
  const k1 = randomBytes(32)
  const k2 = randomBytes(32)
  const oldRing = new Keyring(new Map([[1, k1]]), 1)
  const sealed = oldRing.seal('legacy row', aad)

  const rotated = new Keyring(
    new Map([
      [1, k1],
      [2, k2],
    ]),
    2,
  )
  assert.equal(rotated.currentVersion, 2)
  assert.equal(rotated.openString(sealed, aad), 'legacy row')
  const fresh = rotated.seal('new row', aad)
  assert.equal(fresh.v, 2)
  assert.equal(rotated.openString(fresh, aad), 'new row')
})

test('rejects malformed keys', () => {
  assert.throws(() => new Keyring(new Map(), 1))
  assert.throws(() => new Keyring(new Map([[1, randomBytes(16)]]), 1))
  assert.throws(() => new Keyring(new Map([[0, randomBytes(32)]]), 0))
  assert.throws(() => new Keyring(new Map([[1, randomBytes(32)]]), 2))
})

test('isSealedValue recognises the shape', () => {
  const ring = new Keyring(new Map([[1, randomBytes(32)]]), 1)
  assert.equal(isSealedValue(ring.seal('x', aad)), true)
  assert.equal(isSealedValue({ ct: 'a', iv: 'b', tag: 'c' }), false)
  assert.equal(isSealedValue(null), false)
  assert.equal(isSealedValue('x'), false)
})
