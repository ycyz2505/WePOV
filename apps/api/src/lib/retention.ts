/**
 * Log retention janitor.
 *
 * The design promises 60 days of HTTP request index and 90 days of semantic
 * events. Without a scheduled cleanup those tables are the only part of the
 * database that grows without bound, which matters on free tiers (Altare 1 GB,
 * Neon 1 GB per project).
 *
 * Deliberately conservative:
 * - HTTP request index is the largest table, so it is trimmed first.
 * - Semantic events are small but kept longer because they answer "who did
 *   what" during investigations.
 * - Both statements are idempotent and safe to run concurrently.
 * - Failures never propagate: retention must not take the API down.
 */

export interface RetentionQuerier {
  (sql: string, params?: unknown[]): Promise<{ rowCount: number | null }>
}

export interface RetentionOptions {
  /** Days to keep `request_log_index` rows. Default 60. */
  httpDays?: number
  /** Days to keep `semantic_events` rows. Default 90. */
  semanticDays?: number
}

export interface RetentionResult {
  requestLogIndex: number
  requestLogStaging: number
  semanticEvents: number
  httpDays: number
  semanticDays: number
}

export const DEFAULT_HTTP_RETENTION_DAYS = 60
export const DEFAULT_SEMANTIC_RETENTION_DAYS = 90

/** Integer days clamped to a sane range; invalid input falls back to default. */
export function clampRetentionDays(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  const rounded = Math.floor(value)
  return Math.min(3650, Math.max(1, rounded))
}

export async function runRetention(
  query: RetentionQuerier,
  options: RetentionOptions = {},
): Promise<RetentionResult> {
  const httpDays = clampRetentionDays(options.httpDays, DEFAULT_HTTP_RETENTION_DAYS)
  const semanticDays = clampRetentionDays(options.semanticDays, DEFAULT_SEMANTIC_RETENTION_DAYS)

  const index = await query(
    `DELETE FROM request_log_index
      WHERE created_at < now() - ($1::int * interval '1 day')`,
    [httpDays],
  )
  const staging = await query(
    `DELETE FROM request_log_staging
      WHERE created_at < now() - ($1::int * interval '1 day')`,
    [httpDays],
  )
  const semantic = await query(
    `DELETE FROM semantic_events
      WHERE created_at < now() - ($1::int * interval '1 day')`,
    [semanticDays],
  )

  return {
    requestLogIndex: index.rowCount ?? 0,
    requestLogStaging: staging.rowCount ?? 0,
    semanticEvents: semantic.rowCount ?? 0,
    httpDays,
    semanticDays,
  }
}
