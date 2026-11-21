import type { FastifyPluginAsync } from 'fastify'
import { getPool } from '@wepov/database'
import { ApiError, validationError } from '../errors.js'
import { notificationPreferencesSchema } from '../schemas.js'
import { clampLimit, decodeCursor, encodeCursor } from '../lib/cursor.js'

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function toNotification(row: NotificationRow) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    href: row.href,
    readAt: row.read_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  }
}

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/notifications', async (request) => {
    const auth = app.requireAuth(request)
    const query = request.query as { cursor?: string; limit?: string | number }
    const cursor = decodeCursor(query.cursor)
    if (query.cursor && !cursor) throw ApiError.badRequest('invalid_cursor', '分页游标无效')
    const limit = clampLimit(query.limit === undefined ? undefined : Number(query.limit))
    const result = await getPool().query<NotificationRow>(
      `SELECT id, seq::text, kind, title, body, href, read_at, created_at
         FROM notifications
        WHERE class_id = $1 AND user_id = $2 AND muted = false
          AND ($3::bigint IS NULL OR seq < $3::bigint)
        ORDER BY seq DESC
        LIMIT $4`,
      [auth.classId, auth.userId, cursor?.k ?? null, limit + 1],
    )
    const hasMore = result.rows.length > limit
    const rows = result.rows.slice(0, limit)
    const last = rows.at(-1)
    return {
      items: rows.map(toNotification),
      nextCursor: hasMore && last ? encodeCursor({ k: String(last.seq), i: last.id }) : null,
    }
  })

  app.get('/api/v1/notifications/unread-count', async (request) => {
    const auth = app.requireAuth(request)
    const result = await getPool().query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM notifications
        WHERE class_id = $1 AND user_id = $2 AND read_at IS NULL AND muted = false`,
      [auth.classId, auth.userId],
    )
    return { count: Number(result.rows[0]?.count ?? 0) }
  })

  app.post('/api/v1/notifications/:id/read', async (request, reply) => {
    const auth = app.requireAuth(request)
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) throw ApiError.badRequest('invalid_notification_id', '通知编号无效')
    const result = await getPool().query(
      `UPDATE notifications SET read_at = COALESCE(read_at, now())
        WHERE id = $1 AND class_id = $2 AND user_id = $3`,
      [id, auth.classId, auth.userId],
    )
    if ((result.rowCount ?? 0) === 0) throw ApiError.notFound('notification_not_found', '通知不存在')
    reply.status(204).send()
  })

  app.post('/api/v1/notifications/read-all', async (request, reply) => {
    const auth = app.requireAuth(request)
    await getPool().query(
      `UPDATE notifications SET read_at = now()
        WHERE class_id = $1 AND user_id = $2 AND read_at IS NULL`,
      [auth.classId, auth.userId],
    )
    reply.status(204).send()
  })

  app.patch('/api/v1/notifications/preferences', async (request, reply) => {
    const auth = app.requireAuth(request)
    const parsed = notificationPreferencesSchema.safeParse(request.body)
    if (!parsed.success) throw validationError(parsed.error.issues)
    const key = `notification.preferences.${auth.userId}`
    await getPool().query(
      `INSERT INTO app_settings (class_id, key, value)
       VALUES ($1,$2,$3)
       ON CONFLICT (class_id, key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [auth.classId, key, JSON.stringify(parsed.data)],
    )
    reply.status(204).send()
  })
}
