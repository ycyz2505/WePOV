import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { migrate } from '../src/migrate.js'

/**
 * Schema integration tests. These run against a real Postgres (CI service
 * container) because the invariants they cover are enforced by DDL, triggers
 * and CHECK constraints — the exact layer a mock would skip.
 *
 * Requires DATABASE_URL. Locally: `npm run db:migrate` first, or let the suite
 * apply migrations itself (it does, and it is idempotent).
 */

const connectionString = process.env['DATABASE_URL']

if (!connectionString) {
  test('schema integration tests require DATABASE_URL', { skip: 'DATABASE_URL not set' }, () => {})
} else {
  const pool = new pg.Pool({ connectionString, max: 2 })
  const createdClasses: string[] = []

  async function newClass(): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO classes (id, name, gateway_passcode_hash) VALUES ($1, $2, $3)`,
      [id, `测试班级-${id.slice(0, 6)}`, 'test-hash'],
    )
    createdClasses.push(id)
    return id
  }

  before(async () => {
    const applied = await migrate({ connectionString })
    assert.ok(Array.isArray(applied))
  })

  after(async () => {
    // audit_events is append-only, so a class that owns audit rows cannot be
    // deleted by cascade. The CI database is ephemeral, so tolerate that and
    // still remove everything else.
    for (const id of createdClasses) {
      try {
        await pool.query('DELETE FROM classes WHERE id = $1', [id])
      } catch {
        // class owns immutable audit rows; leave it for the container teardown
      }
    }
    await pool.end()
  })

  test('migrations are idempotent: a second run applies nothing', async () => {
    const second = await migrate({ connectionString })
    assert.deepEqual(second, [])
  })

  test('schema_migrations records every migration file', async () => {
    const result = await pool.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name')
    const names = result.rows.map((row) => row.name)
    assert.ok(names.length >= 8, `expected at least 8 migrations, got ${names.length}`)
    assert.equal(names[0], '001_identity.sql')
    for (const name of names) assert.match(name, /^\d{3}_[a-z_]+\.sql$/)
  })

  test('every business table carries class_id', async () => {
    const result = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'class_id'`,
    )
    const tables = new Set(result.rows.map((row) => row.table_name))
    for (const required of ['profiles', 'partner_posts', 'tree_posts', 'album_folders', 'time_capsules', 'audit_events']) {
      assert.ok(tables.has(required), `${required} is missing class_id`)
    }
  })

  test('audit_events is append-only', async () => {
    const classId = await newClass()
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO audit_events (class_id, actor_role, action) VALUES ($1, 'student', 'test.action') RETURNING id`,
      [classId],
    )
    const id = inserted.rows[0]!.id
    await assert.rejects(
      () => pool.query(`UPDATE audit_events SET action = 'changed' WHERE id = $1`, [id]),
      /append-only/,
    )
    await assert.rejects(() => pool.query(`DELETE FROM audit_events WHERE id = $1`, [id]), /append-only/)
  })

  test('updated_at advances on UPDATE via trigger', async () => {
    const classId = await newClass()
    const before = await pool.query<{ updated_at: Date }>('SELECT updated_at FROM classes WHERE id = $1', [classId])
    await new Promise((resolve) => setTimeout(resolve, 10))
    await pool.query('UPDATE classes SET name = $2 WHERE id = $1', [classId, '改名后'])
    const after = await pool.query<{ updated_at: Date }>('SELECT updated_at FROM classes WHERE id = $1', [classId])
    assert.ok(after.rows[0]!.updated_at > before.rows[0]!.updated_at)
  })

  test('nickname rejects newlines and over-length values', async () => {
    const classId = await newClass()
    const userId = randomUUID()
    await pool.query('INSERT INTO users (id) VALUES ($1)', [userId])
    await assert.rejects(
      () =>
        pool.query(
          `INSERT INTO profiles (user_id, class_id, nickname, nickname_norm) VALUES ($1, $2, $3, $3)`,
          [userId, classId, 'a\nb'],
        ),
      /nickname/,
    )
    await assert.rejects(
      () =>
        pool.query(
          `INSERT INTO profiles (user_id, class_id, nickname, nickname_norm) VALUES ($1, $2, $3, $3)`,
          [userId, classId, '一二三四五六七八九十一二三'],
        ),
      /nickname/,
    )
  })

  test('tree posts cap tags at five and enforce the status enum', async () => {
    const classId = await newClass()
    await assert.rejects(
      () =>
        pool.query(
          `INSERT INTO tree_posts (class_id, content, tags) VALUES ($1, 'x', $2)`,
          [classId, ['a', 'b', 'c', 'd', 'e', 'f']],
        ),
      /tags/,
    )
    await assert.rejects(
      () =>
        pool.query(`INSERT INTO tree_posts (class_id, content, status) VALUES ($1, 'x', 'bogus')`, [classId]),
      /status/,
    )
  })

  test('the identity HMAC is constrained to 64 hex characters', async () => {
    const classId = await newClass()
    const post = await pool.query<{ id: string }>(
      `INSERT INTO tree_posts (class_id, content) VALUES ($1, '匿名') RETURNING id`,
      [classId],
    )
    const postId = post.rows[0]!.id
    await assert.rejects(
      () =>
        pool.query(
          `INSERT INTO tree_identity_map (post_id, class_id, author_enc, author_hmac) VALUES ($1, $2, '{}'::jsonb, 'short')`,
          [postId, classId],
        ),
      /author_hmac/,
    )
    await pool.query(
      `INSERT INTO tree_identity_map (post_id, class_id, author_enc, author_hmac) VALUES ($1, $2, '{}'::jsonb, $3)`,
      [postId, classId, 'a'.repeat(64)],
    )
  })

  test('deleting a class cascades its content', async () => {
    const classId = await newClass()
    await pool.query(`INSERT INTO tree_posts (class_id, content) VALUES ($1, '待级联删除')`, [classId])
    await pool.query('DELETE FROM classes WHERE id = $1', [classId])
    createdClasses.splice(createdClasses.indexOf(classId), 1)
    const remaining = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM tree_posts WHERE class_id = $1',
      [classId],
    )
    assert.equal(remaining.rows[0]!.count, '0')
  })
  test('a class allows only one active super admin role assignment', async () => {
    const classId = await newClass()
    const userId = randomUUID()
    await pool.query('INSERT INTO users (id) VALUES ($1)', [userId])
    await pool.query(
      `INSERT INTO role_assignments (class_id, user_id, role) VALUES ($1, $2, 'super_admin')`,
      [classId, userId],
    )
    const second = randomUUID()
    await pool.query('INSERT INTO users (id) VALUES ($1)', [second])
    await assert.rejects(
      () => pool.query(`INSERT INTO role_assignments (class_id, user_id, role) VALUES ($1, $2, 'super_admin')`, [classId, second]),
      /role_assignments/,
    )
  })

  test('gateway credential token hashes are unique', async () => {
    const classId = await newClass()
    const expires = new Date(Date.now() + 3600_000)
    await pool.query(
      `INSERT INTO gateway_credentials (class_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [classId, 'dup-token', expires],
    )
    await assert.rejects(
      () =>
        pool.query(`INSERT INTO gateway_credentials (class_id, token_hash, expires_at) VALUES ($1, $2, $3)`, [
          classId,
          'dup-token',
          expires,
        ]),
      /gateway_credentials/,
    )
  })
}
