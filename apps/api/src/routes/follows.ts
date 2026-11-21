import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { getPool, withTransaction } from '@wepov/database'
import { ApiError, validationError } from '../errors.js'

const paramsSchema = z.object({ userId: z.string().uuid() })

async function ensureTarget(classId: string, viewerId: string, targetId: string): Promise<void> {
  if (viewerId === targetId) throw ApiError.badRequest('self_action', '不能对自己执行这个操作')
  const result = await getPool().query(
    `SELECT 1 FROM profiles p
      JOIN class_members cm ON cm.class_id = p.class_id AND cm.user_id = p.user_id
      JOIN users u ON u.id = p.user_id
     WHERE p.class_id = $1 AND p.user_id = $2 AND cm.hidden = false
       AND u.is_active = true AND u.deleted_at IS NULL`,
    [classId, targetId],
  )
  if (!result.rows[0]) throw ApiError.notFound('profile_not_found', '没有找到这位同学')
}

async function mutualState(classId: string, viewerId: string, targetId: string): Promise<boolean> {
  const result = await getPool().query(
    `SELECT 1 FROM follows a
      JOIN follows b ON b.class_id = a.class_id AND b.follower_id = a.followee_id AND b.followee_id = a.follower_id
     WHERE a.class_id = $1 AND a.follower_id = $2 AND a.followee_id = $3`,
    [classId, viewerId, targetId],
  )
  return Boolean(result.rows[0])
}

export const followRoutes: FastifyPluginAsync = async (app) => {
  app.put('/api/v1/follows/:userId', async (request) => {
    const auth = app.requireAuth(request)
    const parsed = paramsSchema.safeParse(request.params)
    if (!parsed.success) throw validationError(parsed.error.issues)
    const targetId = parsed.data.userId
    await ensureTarget(auth.classId, auth.userId, targetId)

    await withTransaction(async (tx) => {
      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO follows (class_id, follower_id, followee_id)
         VALUES ($1,$2,$3)
         ON CONFLICT (class_id, follower_id, followee_id) DO NOTHING
         RETURNING id`,
        [auth.classId, auth.userId, targetId],
      )
      if (inserted.rows[0]) {
        await tx.query(
          `UPDATE profiles SET following_count = following_count + 1 WHERE class_id = $1 AND user_id = $2`,
          [auth.classId, auth.userId],
        )
        await tx.query(
          `UPDATE profiles SET follower_count = follower_count + 1 WHERE class_id = $1 AND user_id = $2`,
          [auth.classId, targetId],
        )
      }
    })
    return { following: true, mutual: await mutualState(auth.classId, auth.userId, targetId) }
  })

  app.delete('/api/v1/follows/:userId', async (request) => {
    const auth = app.requireAuth(request)
    const parsed = paramsSchema.safeParse(request.params)
    if (!parsed.success) throw validationError(parsed.error.issues)
    const targetId = parsed.data.userId
    if (auth.userId === targetId) throw ApiError.badRequest('self_action', '不能对自己执行这个操作')

    await withTransaction(async (tx) => {
      const removed = await tx.query<{ id: string }>(
        `DELETE FROM follows
          WHERE class_id = $1 AND follower_id = $2 AND followee_id = $3
          RETURNING id`,
        [auth.classId, auth.userId, targetId],
      )
      if (removed.rows[0]) {
        await tx.query(
          `UPDATE profiles SET following_count = GREATEST(0, following_count - 1)
            WHERE class_id = $1 AND user_id = $2`,
          [auth.classId, auth.userId],
        )
        await tx.query(
          `UPDATE profiles SET follower_count = GREATEST(0, follower_count - 1)
            WHERE class_id = $1 AND user_id = $2`,
          [auth.classId, targetId],
        )
      }
    })
    return { following: false, mutual: false }
  })

  app.post('/api/v1/likes/:userId', async (request) => {
    const auth = app.requireAuth(request)
    const parsed = paramsSchema.safeParse(request.params)
    if (!parsed.success) throw validationError(parsed.error.issues)
    const targetId = parsed.data.userId
    await ensureTarget(auth.classId, auth.userId, targetId)

    const likeCount = await withTransaction(async (tx) => {
      await tx.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2 || ':' || $3, 0))`,
        [auth.classId, auth.userId, targetId],
      )
      const today = await tx.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM profile_likes
          WHERE class_id = $1 AND liker_id = $2 AND target_user_id = $3
            AND like_day = (now() AT TIME ZONE 'UTC')::date`,
        [auth.classId, auth.userId, targetId],
      )
      if (Number(today.rows[0]?.count ?? 0) >= 50) {
        throw ApiError.tooManyRequests('今天给这位同学的点赞已达上限', 3600, 'like_daily_limit')
      }
      await tx.query(
        `INSERT INTO profile_likes (class_id, liker_id, target_user_id) VALUES ($1,$2,$3)`,
        [auth.classId, auth.userId, targetId],
      )
      const updated = await tx.query<{ like_count: number }>(
        `UPDATE profiles SET like_count = like_count + 1
          WHERE class_id = $1 AND user_id = $2
          RETURNING like_count`,
        [auth.classId, targetId],
      )
      return updated.rows[0]?.like_count ?? 0
    })
    return { likeCount }
  })
}
