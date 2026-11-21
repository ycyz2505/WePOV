import { getPool } from '@wepov/database'
import { hmacHex } from '@wepov/security'
import type { AppConfig } from '../config.js'
import type { NotificationBus, BusNotification } from './notification-bus.js'

/**
 * Notification creation + real-time fan-out. Persists to Postgres (source of
 * truth) then publishes to the in-process bus for SSE. Callers may pass an
 * existing transaction handle for atomic creation.
 */

export interface CreateNotificationInput {
  classId: string
  userId: string
  kind: string
  title: string
  body?: string
  href?: string | null
}

interface NotificationRow {
  id: string
  seq: string
  kind: string
  title: string
  body: string
  href: string | null
  read_at: Date | null
  created_at: Date
}

export async function createNotification(
  bus: NotificationBus,
  input: CreateNotificationInput,
): Promise<BusNotification> {
  const result = await getPool().query<NotificationRow>(
    `INSERT INTO notifications (class_id, user_id, kind, title, body, href)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, seq, kind, title, body, href, read_at, created_at`,
    [input.classId, input.userId, input.kind, input.title, input.body ?? '', input.href ?? null],
  )
  const row = result.rows[0]!
  const dto: BusNotification = {
    id: row.id,
    seq: String(row.seq),
    kind: row.kind,
    title: row.title,
    body: row.body,
    href: row.href,
    readAt: row.read_at ? row.read_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  }
  bus.publish(input.userId, dto)
  return dto
}

/** IP pseudonym for logs and abuse keys, derived from the dedicated log key. */
export function ipPseudonym(config: AppConfig, ip: string | null): string | null {
  if (!ip) return null
  return hmacHex(config.security.logIpKey, ip)
}

/** Abuse pseudonym (rate-limit/ban) from the abuse key. */
export function abusePseudonym(config: AppConfig, value: string): string {
  return hmacHex(config.security.abuseKey, value)
}
