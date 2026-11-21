import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify'
import { getPool } from '@wepov/database'
import { hashToken } from '@wepov/security'
import { ApiError } from '../errors.js'
import type { BusNotification } from '../lib/notification-bus.js'

interface SseAuth {
  userId: string
  classId: string
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

function rowToNotification(row: NotificationRow): BusNotification {
  return {
    id: row.id,
    seq: String(row.seq),
    kind: row.kind,
    title: row.title,
    body: row.body,
    href: row.href,
    readAt: row.read_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  }
}

async function lookupByHash(app: FastifyInstance, kind: 'access' | 'refresh', raw: string): Promise<SseAuth | null> {
  const hash = hashToken(app.config.security.sessionPepper, kind, raw)
  const column = kind === 'access' ? 's.access_token_hash' : 's.refresh_token_hash'
  const result = await getPool().query<{ user_id: string; class_id: string }>(
    `SELECT s.user_id, s.class_id
       FROM sessions s
       JOIN session_families f ON f.id = s.family_id
       JOIN users u ON u.id = s.user_id
       JOIN class_members cm ON cm.user_id = s.user_id AND cm.class_id = s.class_id
      WHERE ${column} = $1
        AND s.revoked_at IS NULL AND f.revoked_at IS NULL
        AND s.idle_expires_at > now() AND f.absolute_expires_at > now()
        AND u.is_active = true AND u.deleted_at IS NULL
        AND cm.hidden = false`,
    [hash],
  )
  const row = result.rows[0]
  return row ? { userId: row.user_id, classId: row.class_id } : null
}

/**
 * `EventSource` cannot set an Authorization header, so the stream also accepts
 * the HttpOnly `wepov_stream` (access token) cookie, the persistent refresh
 * cookie, or an explicit `access_token` query parameter (native clients).
 */
async function resolveSseAuth(app: FastifyInstance, request: FastifyRequest): Promise<SseAuth> {
  if (request.auth) return { userId: request.auth.userId, classId: request.auth.classId }

  const query = request.query as { access_token?: unknown; token?: unknown }
  const rawQuery = typeof query.access_token === 'string'
    ? query.access_token
    : typeof query.token === 'string'
      ? query.token
      : null
  if (rawQuery && rawQuery.length <= 512) {
    const byQuery = await lookupByHash(app, 'access', rawQuery)
    if (byQuery) return byQuery
  }

  const streamToken = request.cookies['wepov_stream']
  if (typeof streamToken === 'string' && streamToken.length > 0) {
    const byStream = await lookupByHash(app, 'access', streamToken)
    if (byStream) return byStream
  }

  const refreshToken = request.cookies['wepov_refresh']
  if (typeof refreshToken === 'string' && refreshToken.length > 0) {
    const byRefresh = await lookupByHash(app, 'refresh', refreshToken)
    if (byRefresh) return byRefresh
  }

  throw ApiError.unauthorized()
}

function parseCursor(request: FastifyRequest): string {
  const query = request.query as { cursor?: unknown }
  const header = request.headers['last-event-id']
  const candidate = typeof query.cursor === 'string'
    ? query.cursor
    : typeof header === 'string'
      ? header
      : '0'
  return /^\d+$/.test(candidate) ? candidate : '0'
}

function sseFrame(notification: BusNotification): string {
  const payload = {
    id: notification.id,
    kind: notification.kind,
    title: notification.title,
    body: notification.body,
    href: notification.href,
    readAt: notification.readAt,
    createdAt: notification.createdAt,
  }
  return `id: ${notification.seq}\nevent: notification\ndata: ${JSON.stringify(payload)}\n\n`
}

export const eventsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/events', async (request, reply) => {
    const auth = await resolveSseAuth(app, request)
    const cursor = parseCursor(request)
    const pending: BusNotification[] = []
    let streaming = false
    let closed = false
    const unsubscribe = app.notifications.subscribe(auth.userId, (notification) => {
      if (!streaming) {
        pending.push(notification)
        return
      }
      if (!closed && !reply.raw.destroyed && !reply.raw.writableEnded) {
        reply.raw.write(sseFrame(notification))
      }
    })

    let catchup: BusNotification[]
    try {
      const result = await getPool().query<NotificationRow>(
        `SELECT id, seq::text, kind, title, body, href, read_at, created_at
           FROM notifications
          WHERE class_id = $1 AND user_id = $2 AND muted = false AND seq > $3::bigint
          ORDER BY seq ASC
          LIMIT 500`,
        [auth.classId, auth.userId, cursor],
      )
      catchup = result.rows.map(rowToNotification)
    } catch (error) {
      unsubscribe()
      throw error
    }

    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    reply.raw.flushHeaders?.()
    reply.raw.write(': connected\n\n')

    const sent = new Set<string>()
    for (const notification of catchup) {
      sent.add(notification.seq)
      reply.raw.write(sseFrame(notification))
    }
    pending.sort((left, right) => {
      const a = BigInt(left.seq)
      const b = BigInt(right.seq)
      return a < b ? -1 : a > b ? 1 : 0
    })
    for (const notification of pending) {
      if (sent.has(notification.seq)) continue
      sent.add(notification.seq)
      reply.raw.write(sseFrame(notification))
    }
    pending.length = 0
    streaming = true

    const ping = setInterval(() => {
      if (!closed && !reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.write(': ping\n\n')
    }, 25_000)
    ping.unref?.()
    const lifetime = setTimeout(() => {
      if (!closed && !reply.raw.destroyed && !reply.raw.writableEnded) {
        reply.raw.write(': reconnect\n\n')
        reply.raw.end()
      }
    }, 10 * 60_000)
    lifetime.unref?.()

    const cleanup = (): void => {
      if (closed) return
      closed = true
      clearInterval(ping)
      clearTimeout(lifetime)
      unsubscribe()
    }
    // Only the response socket is reliable here: in modern Node, the request's
    // own 'close' fires as soon as the request body is complete, which for a GET
    // is immediately and would unsubscribe before the first notification.
    request.raw.once('aborted', cleanup)
    reply.raw.once('close', cleanup)
    reply.raw.once('finish', cleanup)
  })
}
