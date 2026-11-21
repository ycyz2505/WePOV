import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeCursor, decodeCursor, clampLimit, DEFAULT_LIMIT, MAX_LIMIT } from '../src/lib/cursor.js'

test('a cursor round-trips', () => {
  const cursor = { k: '2026-01-01T00:00:00.000Z', i: '0f8fad5b-d9cb-469f-a165-70867728950e' }
  assert.deepEqual(decodeCursor(encodeCursor(cursor)), cursor)
})

test('cursors are opaque base64url, not readable JSON', () => {
  const encoded = encodeCursor({ k: '123', i: 'abc' })
  assert.match(encoded, /^[A-Za-z0-9_-]+$/)
  assert.ok(!encoded.includes('{'))
  assert.ok(!encoded.includes('='))
})

test('a malformed cursor decodes to null instead of throwing', () => {
  assert.equal(decodeCursor('not-a-cursor'), null)
  assert.equal(decodeCursor(''), null)
  assert.equal(decodeCursor(null), null)
  assert.equal(decodeCursor(undefined), null)
})

test('a cursor with the wrong shape decodes to null', () => {
  const missingId = Buffer.from(JSON.stringify({ k: '1' }), 'utf8').toString('base64url')
  const numeric = Buffer.from(JSON.stringify({ k: 1, i: 2 }), 'utf8').toString('base64url')
  assert.equal(decodeCursor(missingId), null)
  assert.equal(decodeCursor(numeric), null)
})

test('clampLimit falls back to the default', () => {
  assert.equal(clampLimit(undefined), DEFAULT_LIMIT)
  assert.equal(clampLimit(Number.NaN), DEFAULT_LIMIT)
  assert.equal(clampLimit(Number.POSITIVE_INFINITY), DEFAULT_LIMIT)
})

test('clampLimit bounds both ends', () => {
  assert.equal(clampLimit(0), 1)
  assert.equal(clampLimit(-5), 1)
  assert.equal(clampLimit(10), 10)
  assert.equal(clampLimit(MAX_LIMIT + 1), MAX_LIMIT)
  assert.equal(clampLimit(12.9), 12)
})
