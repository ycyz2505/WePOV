import pg from 'pg'

const { Pool } = pg

/**
 * Connection pool for the WePOV API and maintenance scripts.
 *
 * Constraints come straight from the design (§15.3): at most 8 connections and
 * a ~2s statement_timeout so a runaway query cannot pin a worker on a 1.5 vCPU
 * box. A single pool is shared process-wide via getPool().
 *
 * Altare's managed Postgres hostname exists only in its split-horizon DNS. Some
 * Docker hosts do not receive that resolver and mount `/etc/hosts` read-only.
 * `DATABASE_RESOLVED_IP` lets start.sh supply the A record while we keep
 * `DATABASE_URL`'s original hostname as TLS `servername` for certificate checks.
 */

export type QueryParam = unknown

let pool: pg.Pool | null = null

export interface PoolOptions {
  connectionString?: string
  max?: number
  statementTimeoutMs?: number
  applicationName?: string
}

function resolveConnectionString(explicit?: string): string {
  const url = explicit ?? process.env['DATABASE_URL']
  if (!url) {
    throw new Error('DATABASE_URL is not set')
  }
  return url
}

function connectionOptions(connectionString: string): pg.PoolConfig {
  const resolvedIp = process.env['DATABASE_RESOLVED_IP']
  if (!resolvedIp) return { connectionString }

  const url = new URL(connectionString)
  const originalHost = url.hostname
  if (!originalHost) return { connectionString }

  // Remove sslmode from the URL so node-postgres cannot overwrite this explicit
  // TLS object. Keep the original hostname for SNI and certificate validation.
  url.searchParams.delete('sslmode')
  return {
    connectionString: url.toString(),
    host: resolvedIp,
    ssl: {
      rejectUnauthorized: true,
      servername: originalHost,
    },
  }
}

export function createPool(options: PoolOptions = {}): pg.Pool {
  const max = options.max ?? 8
  const statementTimeoutMs = options.statementTimeoutMs ?? 2000
  const connectionString = resolveConnectionString(options.connectionString)
  const created = new Pool({
    ...connectionOptions(connectionString),
    max,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: false,
    application_name: options.applicationName ?? 'wepov-api',
    options: `-c statement_timeout=${statementTimeoutMs}`,
  })
  created.on('error', (err) => {
    console.error(JSON.stringify({ level: 'error', msg: 'pg_pool_error', error: err.message }))
  })
  return created
}

export function getPool(): pg.Pool {
  if (!pool) {
    pool = createPool()
  }
  return pool
}

export async function closePool(): Promise<void> {
  if (pool) {
    const current = pool
    pool = null
    await current.end()
  }
}

/** Run a single parameterized query against the shared pool. */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: QueryParam[] = [],
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(sql, params)
}

/** Convenience for a single row, or null. */
export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: QueryParam[] = [],
): Promise<T | null> {
  const result = await query<T>(sql, params)
  return result.rows[0] ?? null
}

export interface Tx {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params?: QueryParam[],
  ): Promise<pg.QueryResult<T>>
  queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params?: QueryParam[],
  ): Promise<T | null>
}

/**
 * Run `fn` inside a transaction. Any thrown error rolls back. The audit writer
 * relies on this so a failed audit insert aborts the surrounding operation.
 */
export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const tx: Tx = {
      async query<R extends pg.QueryResultRow = pg.QueryResultRow>(
        sql: string,
        params: QueryParam[] = [],
      ): Promise<pg.QueryResult<R>> {
        return client.query<R>(sql, params)
      },
      async queryOne<R extends pg.QueryResultRow = pg.QueryResultRow>(
        sql: string,
        params: QueryParam[] = [],
      ): Promise<R | null> {
        const result = await client.query<R>(sql, params)
        return result.rows[0] ?? null
      },
    }
    const result = await fn(tx)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // Rollback can fail if the connection died; nothing more to do.
    }
    throw error
  } finally {
    client.release()
  }
}

export type { pg }
