import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createPool, closePool } from './pool.js'

/**
 * Explicit, ordered SQL migration runner.
 *
 * - Reads `./migrations/*.sql`, sorted lexically (files are numbered).
 * - Takes a Postgres advisory lock so two deploy processes never race.
 * - Applies each migration in its own transaction.
 * - Records applied filenames + checksum in `schema_migrations`.
 * - Refuses to continue if an already-applied file changed on disk.
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

const ADVISORY_LOCK_KEY = 0x7765_706f_7601 // arbitrary constant unique to WePOV migrations

interface MigrationFile {
  name: string
  sql: string
  checksum: string
}

async function loadMigrations(): Promise<MigrationFile[]> {
  const entries = await readdir(MIGRATIONS_DIR)
  const files = entries.filter((name) => name.endsWith('.sql')).sort((a, b) => a.localeCompare(b))
  const loaded: MigrationFile[] = []
  for (const name of files) {
    const sql = await readFile(join(MIGRATIONS_DIR, name), 'utf8')
    loaded.push({ name, sql, checksum: checksum(sql) })
  }
  return loaded
}

function checksum(input: string): string {
  // Small deterministic hash; not security sensitive, only drift detection.
  let h1 = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    h1 ^= input.charCodeAt(i)
    h1 = Math.imul(h1, 0x01000193) >>> 0
  }
  return h1.toString(16).padStart(8, '0')
}

export async function migrate(options: { connectionString?: string } = {}): Promise<string[]> {
  const pool = createPool({ ...(options.connectionString ? { connectionString: options.connectionString } : {}), max: 1 })
  const applied: string[] = []
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY])
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `)

    const existing = await client.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM schema_migrations',
    )
    const appliedMap = new Map(existing.rows.map((row) => [row.name, row.checksum]))

    const migrations = await loadMigrations()
    for (const migration of migrations) {
      const priorChecksum = appliedMap.get(migration.name)
      if (priorChecksum !== undefined) {
        if (priorChecksum !== migration.checksum) {
          throw new Error(
            `Migration ${migration.name} was modified after being applied (expected ${priorChecksum}, got ${migration.checksum})`,
          )
        }
        continue
      }
      await client.query('BEGIN')
      try {
        await client.query(migration.sql)
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
          migration.name,
          migration.checksum,
        ])
        await client.query('COMMIT')
        applied.push(migration.name)
      } catch (error) {
        await client.query('ROLLBACK')
        throw new Error(
          `Migration ${migration.name} failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    return applied
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY])
    } catch {
      // Ignore unlock failures; the lock releases when the connection closes.
    }
    client.release()
    await pool.end()
  }
}

// Allow `tsx src/migrate.ts` to run it directly.
const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === (await import('node:path')).resolve(process.argv[1])

if (invokedDirectly) {
  migrate()
    .then((applied) => {
      if (applied.length === 0) {
        console.log('No pending migrations.')
      } else {
        console.log(`Applied ${applied.length} migration(s):`)
        for (const name of applied) console.log(`  - ${name}`)
      }
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
    .finally(() => closePool())
}
