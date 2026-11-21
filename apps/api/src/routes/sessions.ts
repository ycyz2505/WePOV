import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { getPool } from '@wepov/database'
import { ApiError } from '../errors.js'
import { requireAuth } from '../lib/auth-guards.js'
import type { DeviceSessionDto } from '../dto.js'

/**
 * Device sessions (§4.6). One row per session family (one device login). The
 * client revokes by family id and cannot touch another student's sessions.
 */

export const sessionRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/sessions', async (request: FastifyRequest) => {
    const auth = requireAuth(request)
    const result = await getPool().query<{
      id: string
      device_id: string
      mode: 'temporary' | 'persistent'
      device_name: string | null
      created_at: Date
      last_seen_at: Date
    }>(
      `SELECT f.id, f.device_id, f.mode, f.created_at,
              d.device_name,
              COALESCE(MAX(s.last_used_at), f.created_at) AS last_seen_at
         FROM session_families f
         LEFT JOIN devices d
                ON d.class_id = f.class_id AND d.user_id = f.user_id AND d.device_id = f.device_id
         LEFT JOIN sessions s ON s.family_id = f.id
        WHERE f.user_id = $1
          AND f.class_id = $2
          AND f.revoked_at IS NULL
          AND f.absolute_expires_at > now()
        GROUP BY f.id, f.device_id, f.mode, f.created_at, d.device_name
        ORDER BY last_seen_at DESC`,
      [auth.userId, auth.classId],
    )

    const items: DeviceSessionDto[] = result.rows.map((row) => ({
      id: row.id,
      deviceName: row.device_name ?? '未知设备',
      mode: row.mode,
      current: row.id === auth.familyId,
      lastSeenAt: row.last_seen_at.toISOString(),
      createdAt: row.created_at.toISOString(),
    }))
    return { items }
  })

  app.delete('/api/v1/sessions/:id', async (request: FastifyRequest, reply) => {
    const auth = requireAuth(request)
    const { id } = request.params as { id: string }
    if (id === auth.familyId) {
      throw ApiError.badRequest('current_session', '不能在这里退出当前设备')
    }

    const owned = await getPool().query<{ id: string }>(
      `SELECT id FROM session_families
        WHERE id = $1 AND user_id = $2 AND class_id = $3 AND revoked_at IS NULL`,
      [id, auth.userId, auth.classId],
    )
    if (!owned.rows[0]) throw ApiError.notFound('session_not_found', '该设备已退出')

    await app.sessions.revokeAllForUser([id], 'revoked_by_user')
    reply.status(204)
  })

  app.delete('/api/v1/sessions', async (request: FastifyRequest, reply) => {
    const auth = requireAuth(request)
    const others = await getPool().query<{ id: string }>(
      `SELECT id FROM session_families
        WHERE user_id = $1 AND class_id = $2 AND id <> $3 AND revoked_at IS NULL`,
      [auth.userId, auth.classId, auth.familyId],
    )
    await app.sessions.revokeAllForUser(
      others.rows.map((row) => row.id),
      'revoked_by_user',
    )
    reply.status(204)
  })
}
