/**
 * Cursor pagination (§19). Cursors are opaque base64url JSON. We use keyset
 * pagination on (sort_key, id) tuples, never OFFSET.
 */

export interface Cursor {
  /** Primary sort value: an ISO timestamp or numeric string. */
  k: string
  /** Tie-breaker id. */
  i: string
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

export function decodeCursor(raw: string | undefined | null): Cursor | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Cursor).k === 'string' &&
      typeof (parsed as Cursor).i === 'string'
    ) {
      return { k: (parsed as Cursor).k, i: (parsed as Cursor).i }
    }
    return null
  } catch {
    return null
  }
}

export const DEFAULT_LIMIT = 30
export const MAX_LIMIT = 100

export function clampLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(value)))
}
