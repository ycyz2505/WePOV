import type { FastifyPluginAsync } from 'fastify'
import { getPool, withTransaction } from '@wepov/database'
import { ApiError, validationError } from '../errors.js'
import { partnerCreateSchema, partnerRespondSchema } from '../schemas.js'
import { clampLimit, decodeCursor, encodeCursor } from '../lib/cursor.js'

interface PartnerRow {
  id: string
  title: string
  kind: 'meal' | 'study' | 'sport' | 'entertainment' | 'travel' | 'activity' | 'other'
  starts_at: Date
  location: string
  capacity: number
  accepted_count: number
  waitlist_count: string
  expires_at: Date
  description: string
  allow_waitlist: boolean
  status: 'open' | 'full' | 'closed' | 'expired' | 'cancelled'
  author_id: string
  owner_nickname: string
  my_response: 'pending' | 'accepted' | 'waitlist' | 'declined' | 'cancelled' | null
  created_at: Date
}

function responseState(value: PartnerRow['my_response']): 'pending' | 'confirmed' | 'waitlist' | 'declined' | null {
  if (value === 'accepted') return 'confirmed'
  if (value === 'cancelled' || value === null) return null
  return value
}

function postStatus(row: PartnerRow): 'open' | 'formed' | 'closed' | 'expired' | 'cancelled' {
  if (row.status === 'cancelled') return 'cancelled'
  if (row.status === 'closed') return 'closed'
  if (row.status === 'expired' || row.expires_at.getTime() <= Date.now()) return 'expired'
  if (row.status === 'full' || row.accepted_count >= row.capacity) return 'formed'
  return 'open'
}

function partnerDto(row: PartnerRow) {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    startsAt: row.starts_at.toISOString(),
    location: row.location,
    capacity: row.capacity,
    confirmedCount: row.accepted_count,
    waitlistCount: Number(row.waitlist_count),
    expiresAt: row.expires_at.toISOString(),
    description: row.description,
    allowWaitlist: row.allow_waitlist,
    status: postStatus(row),
    ownerId: row.author_id,
    ownerNickname: row.owner_nickname,
    myResponse: responseState(row.my_response),
    createdAt: row.created_at.toISOString(),
  }
}

const SELECT_POST = `
  SELECT pp.id, pp.title, pp.kind, pp.starts_at, pp.location, pp.capacity,
         pp.accepted_count, pp.expires_at, pp.description, pp.allow_waitlist,
         pp.status, pp.author_id, owner.nickname AS owner_nickname, pp.created_at,
         COALESCE((SELECT count(*)::text FROM partner_responses wr
                    WHERE wr.post_id = pp.id AND wr.status = 'waitlist'), '0') AS waitlist_count,
         mine.status AS my_response
    FROM partner_posts pp
    JOIN profiles owner ON owner.user_id = pp.author_id AND owner.class_id = pp.class_id
    LEFT JOIN partner_responses mine ON mine.post_id = pp.id AND mine.user_id = $2
`

async function findPost(classId: string, postId: string, viewerId: string): Promise<PartnerRow> {
  const result = await getPool().query<PartnerRow>(
    `${SELECT_POST} WHERE pp.class_id = $1 AND pp.id = $3`,
    [classId, viewerId, postId],
  )
  const row = result.rows[0]
  if (!row) throw ApiError.notFound('partner_not_found', '搭子邀约不存在')
  return row
}

export const partnerRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/partners', async (request) => {
    const auth = app.requireAuth(request)
    const query = request.query as { status?: string; cursor?: string; limit?: string | number }
    const cursor = decodeCursor(query.cursor)
    if (query.cursor && !cursor) throw ApiError.badRequest('invalid_cursor', '分页游标无效')
    const limit = clampLimit(typeof query.limit === 'number' ? query.limit : Number(query.limit))
    const params: unknown[] = [auth.classId, auth.userId]
    const where = [`pp.class_id = $1`]
    if (query.status && ['open', 'formed', 'closed', 'expired', 'cancelled'].includes(query.status)) {
      if (query.status === 'formed') where.push(`pp.status = 'full'`)
      else if (query.status === 'open') where.push(`pp.status = 'open' AND pp.expires_at > now()`)
      else if (query.status === 'expired') where.push(`(pp.status = 'expired' OR (pp.status = 'open' AND pp.expires_at <= now()))`)
      else {
        params.push(query.status)
        where.push(`pp.status = $${params.length}`)
      }
    }
    if (cursor) {
      params.push(cursor.k, cursor.i)
      where.push(`(pp.created_at, pp.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`)
    }
    params.push(limit + 1)
    const result = await getPool().query<PartnerRow>(
      `${SELECT_POST}
       WHERE ${where.join(' AND ')}
       ORDER BY pp.created_at DESC, pp.id DESC
       LIMIT $${params.length}`,
      params,
    )
    const hasMore = result.rows.length > limit
    const rows = result.rows.slice(0, limit)
    const last = rows.at(-1)
    return {
      items: rows.map(partnerDto),
      nextCursor:
        hasMore && last
          ? encodeCursor({ k: last.created_at.toISOString(), i: last.id })
          : null,
    }
  })

  app.get('/api/v1/partners/:id', async (request) => {
    const auth = app.requireAuth(request)
    const { id } = request.params as { id: string }
    return partnerDto(await findPost(auth.classId, id, auth.userId))
  })

  app.post('/api/v1/partners', async (request, reply) => {
    const auth = app.requireAuth(request)
    const parsed = partnerCreateSchema.safeParse(request.body)
    if (!parsed.success) throw validationError(parsed.error.issues)
    const startsAt = new Date(parsed.data.startsAt)
    const expiresAt = new Date(parsed.data.expiresAt)
    if (startsAt.getTime() <= Date.now()) {
      throw ApiError.badRequest('partner_start_invalid', '开始时间必须晚于当前时间')
    }
    if (expiresAt.getTime() <= Date.now() || expiresAt.getTime() > startsAt.getTime()) {
      throw ApiError.badRequest('partner_expiry_invalid', '报名截止时间必须晚于当前时间且不晚于开始时间')
    }
    const result = await getPool().query<{ id: string }>(
      `INSERT INTO partner_posts
         (class_id, author_id, title, kind, starts_at, location, capacity,
          expires_at, description, allow_waitlist)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        auth.classId,
        auth.userId,
        parsed.data.title,
        parsed.data.kind,
        startsAt,
        parsed.data.location,
        parsed.data.capacity,
        expiresAt,
        parsed.data.description,
        parsed.data.allowWaitlist,
      ],
    )
    reply.status(201)
    return partnerDto(await findPost(auth.classId, result.rows[0]!.id, auth.userId))
  })

  app.post('/api/v1/partners/:id/responses', async (request) => {
    const auth = app.requireAuth(request)
    const { id } = request.params as { id: string }
    const parsed = partnerRespondSchema.safeParse(request.body)
    if (!parsed.success) throw validationError(parsed.error.issues)
    const state = await withTransaction(async (tx) => {
      const post = await tx.queryOne<{
        author_id: string
        status: string
        expires_at: Date
        allow_waitlist: boolean
      }>(
        `SELECT author_id, status, expires_at, allow_waitlist
           FROM partner_posts WHERE id = $1 AND class_id = $2 FOR UPDATE`,
        [id, auth.classId],
      )
      if (!post) throw ApiError.notFound('partner_not_found', '搭子邀约不存在')
      if (post.author_id === auth.userId) {
        throw ApiError.badRequest('partner_owner_response', '不能报名自己发布的邀约')
      }
      if (!['open', 'full'].includes(post.status) || post.expires_at.getTime() <= Date.now()) {
        throw ApiError.conflict('partner_closed', '该邀约已停止报名')
      }
      const existing = await tx.queryOne<{ status: PartnerRow['my_response'] }>(
        `SELECT status FROM partner_responses WHERE post_id = $1 AND user_id = $2`,
        [id, auth.userId],
      )
      if (existing?.status === 'accepted') return 'confirmed' as const
      const next = post.status === 'full' ? (post.allow_waitlist ? 'waitlist' : null) : 'pending'
      if (!next) throw ApiError.conflict('partner_full', '该邀约人数已满')
      await tx.query(
        `INSERT INTO partner_responses (class_id, post_id, user_id, note, status)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (post_id, user_id) DO UPDATE
           SET note = EXCLUDED.note, status = EXCLUDED.status, updated_at = now()`,
        [auth.classId, id, auth.userId, parsed.data.note, next],
      )
      return next
    })
    return { state }
  })

  app.get('/api/v1/partners/:id/responses', async (request) => {
    const auth = app.requireAuth(request)
    const { id } = request.params as { id: string }
    const owner = await getPool().query(
      `SELECT 1 FROM partner_posts WHERE id = $1 AND class_id = $2 AND author_id = $3`,
      [id, auth.classId, auth.userId],
    )
    if (!owner.rowCount) throw ApiError.forbidden('partner_responses_forbidden', '只有发布者可以查看报名列表')
    const result = await getPool().query<{
      id: string
      user_id: string
      nickname: string
      note: string
      status: PartnerRow['my_response']
      created_at: Date
    }>(
      `SELECT pr.id, pr.user_id, p.nickname, pr.note, pr.status, pr.created_at
         FROM partner_responses pr
         JOIN profiles p ON p.user_id = pr.user_id AND p.class_id = pr.class_id
        WHERE pr.post_id = $1 AND pr.class_id = $2 AND pr.status <> 'cancelled'
        ORDER BY CASE pr.status WHEN 'pending' THEN 0 WHEN 'accepted' THEN 1 WHEN 'waitlist' THEN 2 ELSE 3 END,
                 pr.created_at`,
      [id, auth.classId],
    )
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        nickname: row.nickname,
        note: row.note,
        state: responseState(row.status) ?? 'declined',
        createdAt: row.created_at.toISOString(),
      })),
    }
  })

  app.post('/api/v1/partners/:id/responses/:userId/confirm', async (request) => {
    const auth = app.requireAuth(request)
    const { id, userId } = request.params as { id: string; userId: string }
    await withTransaction(async (tx) => {
      const post = await tx.queryOne<{
        author_id: string
        capacity: number
        accepted_count: number
        status: string
        expires_at: Date
        allow_waitlist: boolean
      }>(
        `SELECT author_id, capacity, accepted_count, status, expires_at, allow_waitlist
           FROM partner_posts WHERE id = $1 AND class_id = $2 FOR UPDATE`,
        [id, auth.classId],
      )
      if (!post) throw ApiError.notFound('partner_not_found', '搭子邀约不存在')
      if (post.author_id !== auth.userId) {
        throw ApiError.forbidden('partner_confirm_forbidden', '只有发布者可以确认报名')
      }
      if (!['open', 'full'].includes(post.status) || post.expires_at.getTime() <= Date.now()) {
        throw ApiError.conflict('partner_closed', '该邀约已停止报名')
      }
      const response = await tx.queryOne<{ status: string }>(
        `SELECT status FROM partner_responses
          WHERE post_id = $1 AND user_id = $2 AND class_id = $3 FOR UPDATE`,
        [id, userId, auth.classId],
      )
      if (!response) throw ApiError.notFound('partner_response_not_found', '报名记录不存在')
      if (response.status === 'accepted') return
      if (!['pending', 'waitlist'].includes(response.status)) {
        throw ApiError.conflict('partner_response_closed', '该报名已处理')
      }
      if (post.accepted_count >= post.capacity) {
        if (post.allow_waitlist) {
          await tx.query(
            `UPDATE partner_responses SET status = 'waitlist', updated_at = now()
              WHERE post_id = $1 AND user_id = $2`,
            [id, userId],
          )
        }
        throw ApiError.conflict('partner_full', '该邀约人数已满')
      }
      const nextCount = post.accepted_count + 1
      await tx.query(
        `UPDATE partner_responses SET status = 'accepted', updated_at = now()
          WHERE post_id = $1 AND user_id = $2`,
        [id, userId],
      )
      await tx.query(
        `UPDATE partner_posts SET accepted_count = $2, status = $3 WHERE id = $1`,
        [id, nextCount, nextCount >= post.capacity ? 'full' : 'open'],
      )
    })
    return { ok: true }
  })

  app.post('/api/v1/partners/:id/close', async (request) => {
    const auth = app.requireAuth(request)
    const { id } = request.params as { id: string }
    const result = await getPool().query(
      `UPDATE partner_posts SET status = 'closed'
        WHERE id = $1 AND class_id = $2 AND author_id = $3 AND status IN ('open','full')`,
      [id, auth.classId, auth.userId],
    )
    if (!result.rowCount) throw ApiError.notFound('partner_not_found', '可关闭的邀约不存在')
    return partnerDto(await findPost(auth.classId, id, auth.userId))
  })

  app.delete('/api/v1/partners/:id', async (request, reply) => {
    const auth = app.requireAuth(request)
    const { id } = request.params as { id: string }
    const result = await getPool().query(
      `UPDATE partner_posts SET status = 'cancelled'
        WHERE id = $1 AND class_id = $2 AND author_id = $3 AND status <> 'cancelled'`,
      [id, auth.classId, auth.userId],
    )
    if (!result.rowCount) throw ApiError.notFound('partner_not_found', '可取消的邀约不存在')
    reply.status(204).send()
  })
}
