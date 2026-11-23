import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_HTTP_RETENTION_DAYS,
  DEFAULT_SEMANTIC_RETENTION_DAYS,
  clampRetentionDays,
  runRetention,
} from '../src/lib/retention.js'

function recorder(rowCount: number | null = 2) {
  const calls: Array<{ sql: string; params?: unknown[] | undefined }> = []
  return {
    calls,
    query: async (sql: string, params?: unknown[]): Promise<{ rowCount: number | null }> => {
      calls.push({ sql, params })
      return { rowCount }
    },
  }
}

test('deletes the HTTP index and staging with the HTTP window', async () => {
  const rec = recorder(3)
  await runRetention(rec.query)

  assert.equal(rec.calls.length, 3)
  assert.match(rec.calls[0]!.sql, /DELETE FROM request_log_index/)
  assert.deepEqual(rec.calls[0]!.params, [DEFAULT_HTTP_RETENTION_DAYS])
  assert.match(rec.calls[1]!.sql, /DELETE FROM request_log_staging/)
  assert.deepEqual(rec.calls[1]!.params, [DEFAULT_HTTP_RETENTION_DAYS])
  assert.match(rec.calls[2]!.sql, /DELETE FROM semantic_events/)
  assert.deepEqual(rec.calls[2]!.params, [DEFAULT_SEMANTIC_RETENTION_DAYS])
})

test('accepts custom windows and reports them back', async () => {
  const rec = recorder(0)
  const result = await runRetention(rec.query, { httpDays: 30, semanticDays: 180 })

  assert.deepEqual(rec.calls[0]!.params, [30])
  assert.deepEqual(rec.calls[2]!.params, [180])
  assert.equal(result.httpDays, 30)
  assert.equal(result.semanticDays, 180)
})

test('returns the deleted row counts', async () => {
  const rec = recorder(7)
  const result = await runRetention(rec.query)

  assert.equal(result.requestLogIndex, 7)
  assert.equal(result.requestLogStaging, 7)
  assert.equal(result.semanticEvents, 7)
})

test('a null rowCount is reported as zero', async () => {
  const rec = recorder(null)
  const result = await runRetention(rec.query)
  assert.equal(result.requestLogIndex, 0)
  assert.equal(result.semanticEvents, 0)
})

test('clampRetentionDays bounds both ends and falls back on invalid input', () => {
  assert.equal(clampRetentionDays(undefined, 60), 60)
  assert.equal(clampRetentionDays(Number.NaN, 60), 60)
  assert.equal(clampRetentionDays(Number.POSITIVE_INFINITY, 60), 60)
  assert.equal(clampRetentionDays(0, 60), 1)
  assert.equal(clampRetentionDays(-5, 60), 1)
  assert.equal(clampRetentionDays(12.9, 60), 12)
  assert.equal(clampRetentionDays(5000, 60), 3650)
})

test('invalid windows fall back to the defaults inside runRetention', async () => {
  const rec = recorder(0)
  const result = await runRetention(rec.query, { httpDays: 0, semanticDays: -1 })

  assert.deepEqual(rec.calls[0]!.params, [1])
  assert.deepEqual(rec.calls[2]!.params, [1])
  assert.equal(result.httpDays, 1)
  assert.equal(result.semanticDays, 1)
})
