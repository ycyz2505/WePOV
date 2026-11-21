import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import {
  hashPassword,
  verifyContainedPassword,
  verifyExactPassword,
  findContainedCandidate,
  makeMatchTag,
  type PasswordRecord,
} from '../src/password.js'

const key = randomBytes(32)

async function record(password: string): Promise<PasswordRecord> {
  return hashPassword(key, password)
}

test('exact verification succeeds for the right password', async () => {
  const rec = await record('class-2026')
  assert.equal(await verifyExactPassword(rec.hash, 'class-2026'), true)
  assert.equal(await verifyExactPassword(rec.hash, 'class-2025'), false)
})

test('the match tag is stable and keyed', async () => {
  const rec = await record('abc123')
  assert.equal(rec.matchTag, makeMatchTag(key, 'abc123'))
  assert.equal(rec.length, 6)
  assert.notEqual(rec.matchTag, makeMatchTag(randomBytes(32), 'abc123'))
})

test('a contained password verifies through noise', async () => {
  const rec = await record('hello')
  const noisy = 'zzzhellozzz'
  const result = await verifyContainedPassword(key, noisy, rec)
  assert.equal(result.ok, true)
  assert.equal(result.candidateFound, true)
})

test('noise on both sides still verifies', async () => {
  const rec = await record('Pa55word')
  const result = await verifyContainedPassword(key, '###Pa55word###', rec)
  assert.equal(result.ok, true)
})

test('a wrong window does not verify', async () => {
  const rec = await record('hello')
  const result = await verifyContainedPassword(key, 'zzzhellxzzz', rec)
  assert.equal(result.ok, false)
  assert.equal(result.candidateFound, false)
})

test('input shorter than the password never matches', async () => {
  const rec = await record('longpassword')
  const result = await verifyContainedPassword(key, 'long', rec)
  assert.equal(result.ok, false)
  assert.equal(result.candidateFound, false)
})

test('findContainedCandidate locates the exact substring', async () => {
  const rec = await record('secret')
  assert.equal(findContainedCandidate(key, 'aasecretbb', 6, rec.matchTag), 'secret')
  assert.equal(findContainedCandidate(key, 'aasecrexbb', 6, rec.matchTag), null)
})

test('a forged tag cannot be matched', async () => {
  const rec = await record('secret')
  const forged = 'a'.repeat(32)
  assert.equal(findContainedCandidate(key, 'aasecretbb', 6, forged), null)
})

test('the match tag is 16 bytes of hex', () => {
  const tag = makeMatchTag(key, 'anything')
  assert.match(tag, /^[0-9a-f]{32}$/)
})

test('two different passwords produce different tags', () => {
  assert.notEqual(makeMatchTag(key, 'a'), makeMatchTag(key, 'b'))
})

test('a match tag computed with the wrong key finds nothing', async () => {
  const rec = await record('secret')
  const result = await verifyContainedPassword(randomBytes(32), 'aasecretbb', rec)
  assert.equal(result.ok, false)
})

test('length out of range is rejected when hashing', async () => {
  await assert.rejects(() => hashPassword(key, ''))
  await assert.rejects(() => hashPassword(key, 'x'.repeat(257)))
})
