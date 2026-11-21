import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import {
  newOpaqueToken,
  hashToken,
  issueToken,
  sha256Hex,
  hashGatewayPasscode,
  newRecoveryCode,
  newInitialPassword,
} from '../src/tokens.js'

const pepper = randomBytes(32)

test('opaque tokens are 256-bit base64url', () => {
  const token = newOpaqueToken()
  assert.equal(Buffer.from(token, 'base64url').length, 32)
  assert.match(token, /^[A-Za-z0-9_-]+$/)
})

test('opaque tokens never repeat', () => {
  const seen = new Set<string>()
  for (let i = 0; i < 2000; i += 1) {
    const token = newOpaqueToken()
    assert.ok(!seen.has(token), 'token collision')
    seen.add(token)
  }
})

test('hashToken is stable and peppered', () => {
  const token = 'fixed-token'
  const a = hashToken(pepper, 'access', token)
  const b = hashToken(pepper, 'access', token)
  assert.equal(a, b)
  assert.equal(a.length, 64)
  assert.notEqual(a, hashToken(randomBytes(32), 'access', token))
})

test('token kinds are domain separated', () => {
  const token = 'fixed-token'
  const kinds = ['access', 'refresh', 'gateway', 'recovery'] as const
  const hashes = new Set(kinds.map((kind) => hashToken(pepper, kind, token)))
  assert.equal(hashes.size, kinds.length)
})

test('issueToken returns a matching pair', () => {
  const issued = issueToken(pepper, 'refresh')
  assert.equal(issued.hash, hashToken(pepper, 'refresh', issued.token))
  assert.notEqual(issued.token, issued.hash)
})

test('sha256Hex matches the known digest', () => {
  assert.equal(
    sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  )
})

test('gateway passcode hash changes with version and pepper', () => {
  const base = hashGatewayPasscode('p', 1, 'class-pass')
  assert.equal(base, hashGatewayPasscode('p', 1, 'class-pass'))
  assert.notEqual(base, hashGatewayPasscode('p', 2, 'class-pass'))
  assert.notEqual(base, hashGatewayPasscode('q', 1, 'class-pass'))
  assert.notEqual(base, hashGatewayPasscode('p', 1, 'class-pass2'))
})

test('recovery codes are three groups of four from the safe alphabet', () => {
  for (let i = 0; i < 200; i += 1) {
    const code = newRecoveryCode()
    assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
    assert.ok(!/[IO01]/.test(code), `ambiguous character in ${code}`)
  }
})

test('initial passwords avoid ambiguous characters', () => {
  for (let i = 0; i < 200; i += 1) {
    const pw = newInitialPassword()
    assert.equal(pw.length, 10)
    assert.ok(!/[Il1O0]/.test(pw), `ambiguous character in ${pw}`)
  }
})
