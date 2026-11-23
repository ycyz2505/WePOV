import type { FastifyInstance } from 'fastify'
import { getPool } from '@wepov/database'
import { runRetention } from './retention.js'

const FIRST_RUN_DELAY_MS = 60_000
const INTERVAL_MS = 24 * 60 * 60 * 1000

/**
 * Runs the retention janitor once shortly after boot and then daily.
 *
 * The first run is delayed so a cold start does not compete with migrations and
 * the first requests. Timers are unref'd so they never keep the process alive.
 */
export function startRetentionJob(app: FastifyInstance): () => void {
  const run = async (): Promise<void> => {
    try {
      const result = await runRetention(
        async (sql, params) => {
          const response = await getPool().query(sql, params)
          return { rowCount: response.rowCount }
        },
        {
          httpDays: app.config.logRetentionHttpDays,
          semanticDays: app.config.logRetentionSemanticDays,
        },
      )
      app.log.info(result, 'log_retention_done')
    } catch (error) {
      app.log.warn(
        { err: error instanceof Error ? error.message : String(error) },
        'log_retention_failed',
      )
    }
  }

  const initial = setTimeout(() => void run(), FIRST_RUN_DELAY_MS)
  initial.unref?.()
  const timer = setInterval(() => void run(), INTERVAL_MS)
  timer.unref?.()

  return () => {
    clearTimeout(initial)
    clearInterval(timer)
  }
}
