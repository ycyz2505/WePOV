import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { randomUUID } from 'node:crypto'
import { getPool, withTransaction, type Tx } from '@wepov/database'
import { hmacHex, isSealedValue, writeAudit } from '@wepov/security'
import { ApiError, validationError } from '../errors.js'
import {
  reactionSchema,
  saveSchema,
  treeCommentCreateSchema,
  treePostCreateSchema,
  voteSchema,
} from '../schemas.js'
import { clampLimit, decodeCursor, encodeCursor } from '../lib/cursor.js'

interface TreePostRow {
  id: string
  content: string
  tags: string[]
  allow_bullet_screen: boolean
  poll: unknown
  status: 'visible' | 'hidden' | 'removed' | 'collapsed'
  moderation_note: string | null
  comment_count: number
  reaction_count: number
  created_at: Date
  updated_at: Date
  author_hmac: string
  saved: boolean
  operator_name?: string | null
}

interface TreeCommentRow {
  id: string
  content: string
  parent_comment_id: string | null
  author_hmac: string
  is_op: boolean
  status: 'visible' | 'hidden' | 'removed' | 'collapsed'
  moderation_note: string | null
  created_at: Date
  updated_at: Date
  alias: string
  operator_name?: string | null
}

interface StoredPoll {
  question: string
  multiple: boolean
  options: Array<{ id: string; label: string }>
}

function requestId(request: FastifyRequest): string | null {
  return (request as FastifyRequest & { requestId?: string }).requestId ?? null
}

function authorHmac(app: Parameters<FastifyPluginAsync>[0], userId: string): string {
  return hmacHex(app.config.security.treeIdentityKey, userId)
}

function parsePoll(value: unknown): StoredPoll | null {
  if (!value || typeof value !== 'object') return null
  const poll = value as Record<string, unknown>
  if (typeof poll['question'] !== 'string' || typeof poll['multiple'] !== 'boolean') return null
  if (!Array.isArray(poll['options'])) return null
  const options = poll['options'].flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const option = item as Record<string, unknown>
    return typeof option['id'] === 'string' && typeof option['label'] === 'string'
      ? [{ id: option['id'], label: option['label'] }]
      : []
  })
  return options.length >= 2 ? { question: poll['question'], multiple: poll['multiple'], options } : null
}

/**
 * Neutral moderation marker (§6.3, Q30): everyone sees "值班管理员已处理".
 * Whether the reason and the operator are shown is decided per action and
 * already filtered by the query (NULL note when not shown to the subject).
 */
function moderation(
  status: TreePostRow['status'] | TreeCommentRow['status'],
  note: string | null,
  operatorName: string | null,
): {
  action: 'hide' | 'remove' | 'collapse'
  placeholder: string
  reason: string | null
  operatorName: string | null
  createdAt: string
} | null {
  if (status === 'visible') return null
  const action = status === 'hidden' ? 'hide' : status === 'collapsed' ? 'collapse' : 'remove'
  return {
    action,
    placeholder: '值班管理员已处理',
    reason: note,
    operatorName,
    createdAt: new Date().toISOString(),
  }
}

async function pollDto(
  postId: string,
  value: unknown,
  viewerHmac: string,
): Promise<{
  question: string
  multiple: boolean
  options: Array<{ id: string; label: string; votes: number; voted: boolean }>
  totalVotes: number
} | null> {
  const poll = parsePoll(value)
  if (!poll) return null
  const result = await getPool().query<{ option_id: string; votes: string; voted: boolean }>(
    `SELECT option_id, count(*)::text AS votes,
            bool_or(voter_hmac = $2) AS voted
       FROM tree_poll_votes
      WHERE post_id = $1
      GROUP BY option_id`,
    [postId, viewerHmac],
  )
  const counts = new Map(result.rows.map((row) => [row.option_id, row]))
  const options = poll.options.map((option) => {
    const count = counts.get(option.id)
    return {
      ...option,
      votes: count ? Number(count.votes) : 0,
      voted: count?.voted ?? false,
    }
  })
  return {
    question: poll.question,
    multiple: poll.multiple,
    options,
    totalVotes: options.reduce((sum, option) => sum + option.votes, 0),
  }
}

async function postDto(app: Parameters<FastifyPluginAsync>[0], row: TreePostRow, viewerId: string) {
  const viewerHmac = authorHmac(app, viewerId)
  const reactions = await getPool().query<{ reaction: string; count: string; reacted: boolean }>(
    `SELECT reaction, count(*)::text AS count,
            bool_or(reactor_hmac = $2) AS reacted
       FROM tree_reactions
      WHERE post_id = $1
      GROUP BY reaction
      ORDER BY reaction`,
    [row.id, viewerHmac],
  )
  const mine = row.author_hmac === viewerHmac
  const visible = row.status === 'visible' || mine
  return {
    id: row.id,
    alias: '洞主',
    isOp: true,
    content: visible ? row.content : '',
    tags: row.tags,
    allowBulletScreen: row.allow_bullet_screen,
    poll: await pollDto(row.id, row.poll, viewerHmac),
    reactions: reactions.rows.map((reaction) => ({
      emoji: reaction.reaction,
      count: Number(reaction.count),
      reacted: reaction.reacted,
    })),
    commentCount: row.comment_count,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    isMine: mine,
    saved: row.saved,
    moderation: moderation(row.status, row.moderation_note, row.operator_name ?? null),
  }
}

async function getPost(classId: string, postId: string, viewerId: string, app: Parameters<FastifyPluginAsync>[0]) {
  const result = await getPool().query<TreePostRow>(
    `SELECT tp.id, tp.content, tp.tags, tp.allow_bullet_screen, tp.poll, tp.status,
            tp.moderation_note, tp.comment_count, tp.reaction_count, tp.created_at,
            tp.updated_at, tim.author_hmac,
            EXISTS (SELECT 1 FROM tree_saves s WHERE s.post_id = tp.id AND s.user_id = $3) AS saved,
            (SELECT p.nickname FROM moderation_actions ma
               JOIN profiles p ON p.user_id = ma.operator_id AND p.class_id = ma.class_id
              WHERE ma.class_id = tp.class_id AND ma.target_type = 'tree_post' AND ma.target_id = tp.id
                AND ma.show_operator = true
              ORDER BY ma.created_at DESC LIMIT 1) AS operator_name
       FROM tree_posts tp
       JOIN tree_identity_map tim ON tim.post_id = tp.id AND tim.class_id = tp.class_id
      WHERE tp.class_id = $1 AND tp.id = $2 AND tp.status <> 'removed'`,
    [classId, postId, viewerId],
  )
  const row = result.rows[0]
  if (!row) throw ApiError.notFound('tree_post_not_found', '树洞内容不存在')
  return postDto(app, row, viewerId)
}

function assertCanPost(request: FastifyRequest): void {
  const auth = request.server.requireAuth(request)
  if (auth.mutedUntil && auth.mutedUntil.getTime() > Date.now()) {
    throw ApiError.forbidden('account_muted', '当前账号暂时不能发布内容')
  }
}

export const treeRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/tree', async (request) => {
    const auth = app.requireAuth(request)
    const query = request.query as {
      sort?: string
      tag?: string
      cursor?: string
      limit?: string | number
    }
    const sort = query.sort === 'active' || query.sort === 'saved' ? query.sort : 'latest'
    const limit = clampLimit(typeof query.limit === 'number' ? query.limit : Number(query.limit))
    const cursor = decodeCursor(query.cursor)
    if (query.cursor && !cursor) throw ApiError.badRequest('invalid_cursor', '分页游标无效')
    const mineHmac = authorHmac(app, auth.userId)
    const params: unknown[] = [auth.classId, auth.userId, mineHmac]
    const where = [`tp.class_id = $1`, `tp.status <> 'removed'`]
    if (query.tag) {
      params.push(query.tag)
      where.push(`$${params.length} = ANY(tp.tags)`)
    }
    if (sort === 'saved') where.push(`saved.user_id IS NOT NULL`)
    if (cursor) {
      params.push(cursor.k, cursor.i)
      if (sort === 'active') {
        where.push(`(tp.reaction_count, tp.id) < ($${params.length - 1}::integer, $${params.length}::uuid)`)
      } else {
        where.push(`(tp.created_at, tp.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`)
      }
    }
    params.push(limit + 1)
    const order = sort === 'active' ? 'tp.reaction_count DESC, tp.id DESC' : 'tp.created_at DESC, tp.id DESC'
    const result = await getPool().query<TreePostRow>(
      `SELECT tp.id, tp.content, tp.tags, tp.allow_bullet_screen, tp.poll, tp.status,
              tp.moderation_note, tp.comment_count, tp.reaction_count, tp.created_at,
              tp.updated_at, tim.author_hmac, (saved.user_id IS NOT NULL) AS saved,
              (SELECT p.nickname FROM moderation_actions ma
                 JOIN profiles p ON p.user_id = ma.operator_id AND p.class_id = ma.class_id
                WHERE ma.class_id = tp.class_id AND ma.target_type = 'tree_post' AND ma.target_id = tp.id
                  AND ma.show_operator = true
                ORDER BY ma.created_at DESC LIMIT 1) AS operator_name
         FROM tree_posts tp
         JOIN tree_identity_map tim ON tim.post_id = tp.id AND tim.class_id = tp.class_id
         LEFT JOIN tree_saves saved ON saved.post_id = tp.id AND saved.user_id = $2
        WHERE ${where.join(' AND ')}
        ORDER BY ${order}
        LIMIT $${params.length}`,
      params,
    )
    const hasMore = result.rows.length > limit
    const rows = result.rows.slice(0, limit)
    const last = rows.at(-1)
    return {
      items: await Promise.all(rows.map((row) => postDto(app, row, auth.userId))),
      nextCursor:
        hasMore && last
          ? encodeCursor({
              k: sort === 'active' ? String(last.reaction_count) : last.created_at.toISOString(),
              i: last.id,
            })
          : null,
    }
  })

  app.get('/api/v1/tree/bullets', async (request) => {
    const auth = app.requireAuth(request)
    const { tag } = request.query as { tag?: string }
    const params: unknown[] = [auth.classId]
    const tagSql = tag ? (params.push(tag), `AND $2 = ANY(tags)`) : ''
    const result = await getPool().query<{ id: string; content: string; tags: string[] }>(
      `SELECT id, content, tags FROM tree_posts
        WHERE class_id = $1 AND status = 'visible' AND allow_bullet_screen = true ${tagSql}
        ORDER BY created_at DESC LIMIT 80`,
      params,
    )
    return { items: result.rows }
  })

  app.get('/api/v1/tree/mine', async (request) => {
    const auth = app.requireAuth(request)
    const { cursor: rawCursor } = request.query as { cursor?: string }
    const cursor = decodeCursor(rawCursor)
    if (rawCursor && !cursor) throw ApiError.badRequest('invalid_cursor', '分页游标无效')
    const params: unknown[] = [auth.classId, auth.userId, authorHmac(app, auth.userId)]
    const cursorSql = cursor
      ? (params.push(cursor.k, cursor.i), `AND (tp.created_at, tp.id) < ($4::timestamptz, $5::uuid)`)
      : ''
    params.push(31)
    const result = await getPool().query<TreePostRow>(
      `SELECT tp.id, tp.content, tp.tags, tp.allow_bullet_screen, tp.poll, tp.status,
              tp.moderation_note, tp.comment_count, tp.reaction_count, tp.created_at,
              tp.updated_at, tim.author_hmac,
              EXISTS (SELECT 1 FROM tree_saves s WHERE s.post_id = tp.id AND s.user_id = $2) AS saved,
              (SELECT p.nickname FROM moderation_actions ma
                 JOIN profiles p ON p.user_id = ma.operator_id AND p.class_id = ma.class_id
                WHERE ma.class_id = tp.class_id AND ma.target_type = 'tree_post' AND ma.target_id = tp.id
                  AND ma.show_operator = true
                ORDER BY ma.created_at DESC LIMIT 1) AS operator_name
         FROM tree_posts tp JOIN tree_identity_map tim ON tim.post_id = tp.id
        WHERE tp.class_id = $1 AND tim.author_hmac = $3 ${cursorSql}
        ORDER BY tp.created_at DESC, tp.id DESC LIMIT $${params.length}`,
      params,
    )
    const rows = result.rows.slice(0, 30)
    const last = rows.at(-1)
    return {
      items: await Promise.all(rows.map((row) => postDto(app, row, auth.userId))),
      nextCursor:
        result.rows.length > 30 && last
          ? encodeCursor({ k: last.created_at.toISOString(), i: last.id })
          : null,
    }
  })

  app.get('/api/v1/tree/:id', async (request) => {
    const auth = app.requireAuth(request)
    const { id } = request.params as { id: string }
    return getPost(auth.classId, id, auth.userId, app)
  })

  app.post('/api/v1/tree', async (request, reply) => {
    assertCanPost(request)
    const auth = app.requireAuth(request)
    const parsed = treePostCreateSchema.safeParse(request.body)
    if (!parsed.success) throw validationError(parsed.error.issues)
    const poll = parsed.data.poll
      ? {
          question: parsed.data.poll.question,
          multiple: parsed.data.poll.multiple,
          options: parsed.data.poll.options.map((label) => ({ id: randomUUID(), label })),
        }
      : null
    const id = await withTransaction(async (tx) => {
      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO tree_posts (class_id, content, tags, allow_bullet_screen, poll)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [auth.classId, parsed.data.content, parsed.data.tags, parsed.data.allowBulletScreen, poll ? JSON.stringify(poll) : null],
      )
      const postId = inserted.rows[0]!.id
      const sealed = app.config.security.encryption.seal(auth.userId, `tree:post:${postId}`)
      await tx.query(
        `INSERT INTO tree_identity_map (post_id, class_id, author_enc, author_hmac, key_version)
         VALUES ($1,$2,$3,$4,$5)`,
        [postId, auth.classId, JSON.stringify(sealed), authorHmac(app, auth.userId), sealed.v],
      )
      return postId
    })
    reply.status(201)
    return getPost(auth.classId, id, auth.userId, app)
  })

  app.delete('/api/v1/tree/:id', async (request, reply) => {
    const auth = app.requireAuth(request)
    const { id } = request.params as { id: string }
    const result = await getPool().query(
      `UPDATE tree_posts tp SET status = 'removed', moderation_note = NULL
        FROM tree_identity_map tim
       WHERE tp.id = $1 AND tp.class_id = $2 AND tim.post_id = tp.id AND tim.author_hmac = $3
         AND tp.status <> 'removed'`,
      [id, auth.classId, authorHmac(app, auth.userId)],
    )
    if (!result.rowCount) throw ApiError.notFound('tree_post_not_found', '树洞内容不存在')
    reply.status(204).send()
  })

  app.get('/api/v1/tree/:id/comments', async (request) => {
    const auth = app.requireAuth(request)
    const { id } = request.params as { id: string }
    const { cursor: rawCursor } = request.query as { cursor?: string }
    const cursor = decodeCursor(rawCursor)
    if (rawCursor && !cursor) throw ApiError.badRequest('invalid_cursor', '分页游标无效')
    const exists = await getPool().query(`SELECT 1 FROM tree_posts WHERE id = $1 AND class_id = $2`, [id, auth.classId])
    if (!exists.rowCount) throw ApiError.notFound('tree_post_not_found', '树洞内容不存在')
    const params: unknown[] = [auth.classId, id]
    const cursorSql = cursor
      ? (params.push(cursor.k, cursor.i), `AND (tc.created_at, tc.id) > ($3::timestamptz, $4::uuid)`)
      : ''
    params.push(31)
    const result = await getPool().query<TreeCommentRow>(
      `SELECT tc.id, tc.content, tc.parent_comment_id, tc.author_hmac, tc.is_op,
              tc.status, tc.moderation_note, tc.created_at, tca.alias,
              (SELECT p.nickname FROM moderation_actions ma
                 JOIN profiles p ON p.user_id = ma.operator_id AND p.class_id = ma.class_id
                WHERE ma.class_id = tc.class_id AND ma.target_type = 'tree_comment' AND ma.target_id = tc.id
                  AND ma.show_operator = true
                ORDER BY ma.created_at DESC LIMIT 1) AS operator_name
         FROM tree_comments tc
         JOIN tree_comment_aliases tca ON tca.post_id = tc.post_id AND tca.author_hmac = tc.author_hmac
        WHERE tc.class_id = $1 AND tc.post_id = $2 AND tc.status <> 'removed' ${cursorSql}
        ORDER BY tc.created_at, tc.id LIMIT $${params.length}`,
      params,
    )
    const viewer = authorHmac(app, auth.userId)
    const rows = result.rows.slice(0, 30)
    const last = rows.at(-1)
    return {
      items: rows.map((row) => ({
        id: row.id,
        alias: row.alias,
        isOp: row.is_op,
        content: row.status === 'visible' || row.author_hmac === viewer ? row.content : '',
        parentCommentId: row.parent_comment_id,
        createdAt: row.created_at.toISOString(),
        isMine: row.author_hmac === viewer,
        moderation: moderation(row.status, row.moderation_note, row.operator_name ?? null),
      })),
      nextCursor:
        result.rows.length > 30 && last
          ? encodeCursor({ k: last.created_at.toISOString(), i: last.id })
          : null,
    }
  })

  app.post('/api/v1/tree/:id/comments', async (request, reply) => {
    assertCanPost(request)
    const auth = app.requireAuth(request)
    const { id: postId } = request.params as { id: string }
    const parsed = treeCommentCreateSchema.safeParse(request.body)
    if (!parsed.success) throw validationError(parsed.error.issues)
    const hmac = authorHmac(app, auth.userId)
    const row = await withTransaction(async (tx) => {
      await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [postId])
      const post = await tx.queryOne<{ author_hmac: string }>(
        `SELECT tim.author_hmac FROM tree_posts tp
         JOIN tree_identity_map tim ON tim.post_id = tp.id
         WHERE tp.id = $1 AND tp.class_id = $2 AND tp.status <> 'removed'`,
        [postId, auth.classId],
      )
      if (!post) throw ApiError.notFound('tree_post_not_found', '树洞内容不存在')
      if (parsed.data.parentCommentId) {
        const parent = await tx.queryOne<{ id: string }>(
          `SELECT id FROM tree_comments WHERE id = $1 AND post_id = $2 AND class_id = $3`,
          [parsed.data.parentCommentId, postId, auth.classId],
        )
        if (!parent) throw ApiError.badRequest('parent_comment_not_found', '回复的评论不存在')
      }
      let alias = await tx.queryOne<{ alias: string }>(
        `SELECT alias FROM tree_comment_aliases WHERE post_id = $1 AND author_hmac = $2`,
        [postId, hmac],
      )
      if (!alias) {
        const isOp = post.author_hmac === hmac
        const next = isOp
          ? '洞主'
          : `树友${Number((await tx.queryOne<{ count: string }>(
              `SELECT count(*)::text AS count FROM tree_comment_aliases WHERE post_id = $1 AND alias <> '洞主'`,
              [postId],
            ))?.count ?? 0) + 1}`
        alias = await tx.queryOne<{ alias: string }>(
          `INSERT INTO tree_comment_aliases (post_id, class_id, author_hmac, alias)
           VALUES ($1,$2,$3,$4) RETURNING alias`,
          [postId, auth.classId, hmac, next],
        )
      }
      const inserted = await tx.queryOne<{ id: string; created_at: Date }>(
        `INSERT INTO tree_comments
           (class_id, post_id, parent_comment_id, content, author_hmac, is_op)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at`,
        [auth.classId, postId, parsed.data.parentCommentId, parsed.data.content, hmac, post.author_hmac === hmac],
      )
      if (!inserted || !alias) throw new Error('comment insert returned no row')
      const sealed = app.config.security.encryption.seal(auth.userId, `tree:comment:${inserted.id}`)
      await tx.query(
        `INSERT INTO tree_comment_identities (comment_id, class_id, author_enc, key_version)
         VALUES ($1,$2,$3,$4)`,
        [inserted.id, auth.classId, JSON.stringify(sealed), sealed.v],
      )
      await tx.query(`UPDATE tree_posts SET comment_count = comment_count + 1 WHERE id = $1`, [postId])
      return {
        id: inserted.id,
        alias: alias.alias,
        isOp: post.author_hmac === hmac,
        createdAt: inserted.created_at,
      }
    })
    reply.status(201)
    return {
      id: row.id,
      alias: row.alias,
      isOp: row.isOp,
      content: parsed.data.content,
      parentCommentId: parsed.data.parentCommentId,
      createdAt: row.createdAt.toISOString(),
      isMine: true,
      moderation: null,
    }
  })

  app.post('/api/v1/tree/:id/reactions', async (request) => {
    const auth = app.requireAuth(request)
    const { id } = request.params as { id: string }
    const parsed = reactionSchema.safeParse(request.body)
    if (!parsed.success) throw validationError(parsed.error.issues)
    await withTransaction(async (tx) => {
      const exists = await tx.queryOne<{ id: string }>(
        `SELECT id FROM tree_posts WHERE id = $1 AND class_id = $2 AND status <> 'removed' FOR UPDATE`,
        [id, auth.classId],
      )
      if (!exists) throw ApiError.notFound('tree_post_not_found', '树洞内容不存在')
      const deleted = await tx.query(
        `DELETE FROM tree_reactions WHERE post_id = $1 AND reactor_hmac = $2 AND reaction = $3`,
        [id, authorHmac(app, auth.userId), parsed.data.emoji],
      )
      if (!deleted.rowCount) {
        await tx.query(
          `INSERT INTO tree_reactions (class_id, post_id, reactor_hmac, reaction) VALUES ($1,$2,$3,$4)`,
          [auth.classId, id, authorHmac(app, auth.userId), parsed.data.emoji],
        )
      }
      await tx.query(
        `UPDATE tree_posts SET reaction_count = (SELECT count(*) FROM tree_reactions WHERE post_id = $1) WHERE id = $1`,
        [id],
      )
    })
    const dto = await getPost(auth.classId, id, auth.userId, app)
    return { reactions: dto.reactions }
  })

  app.post('/api/v1/tree/:id/vote', async (request) => {
    const auth = app.requireAuth(request)
    const { id } = request.params as { id: string }
    const parsed = voteSchema.safeParse(request.body)
    if (!parsed.success) throw validationError(parsed.error.issues)
    const hmac = authorHmac(app, auth.userId)
    const poll = await withTransaction(async (tx) => {
      const post = await tx.queryOne<{ poll: unknown }>(
        `SELECT poll FROM tree_posts WHERE id = $1 AND class_id = $2 AND status = 'visible' FOR UPDATE`,
        [id, auth.classId],
      )
      if (!post) throw ApiError.notFound('tree_post_not_found', '树洞内容不存在')
      const stored = parsePoll(post.poll)
      if (!stored) throw ApiError.badRequest('poll_not_found', '该树洞没有投票')
      const selected = [...new Set(parsed.data.optionIds)]
      if (!stored.multiple && selected.length !== 1) {
        throw ApiError.badRequest('poll_single_choice', '该投票只能选择一项')
      }
      const allowed = new Set(stored.options.map((option) => option.id))
      if (selected.some((optionId) => !allowed.has(optionId))) {
        throw ApiError.badRequest('poll_option_invalid', '投票选项不存在')
      }
      await tx.query(`DELETE FROM tree_poll_votes WHERE post_id = $1 AND voter_hmac = $2`, [id, hmac])
      for (const optionId of selected) {
        await tx.query(
          `INSERT INTO tree_poll_votes (class_id, post_id, voter_hmac, option_id) VALUES ($1,$2,$3,$4)`,
          [auth.classId, id, hmac, optionId],
        )
      }
      return post.poll
    })
    return { poll: await pollDto(id, poll, hmac) }
  })

  app.put('/api/v1/tree/:id/save', async (request) => {
    const auth = app.requireAuth(request)
    const { id } = request.params as { id: string }
    const parsed = saveSchema.safeParse(request.body)
    if (!parsed.success) throw validationError(parsed.error.issues)
    const exists = await getPool().query(
      `SELECT 1 FROM tree_posts WHERE id = $1 AND class_id = $2 AND status <> 'removed'`,
      [id, auth.classId],
    )
    if (!exists.rowCount) throw ApiError.notFound('tree_post_not_found', '树洞内容不存在')
    if (parsed.data.saved) {
      await getPool().query(
        `INSERT INTO tree_saves (class_id, post_id, user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [auth.classId, id, auth.userId],
      )
    } else {
      await getPool().query(`DELETE FROM tree_saves WHERE post_id = $1 AND user_id = $2 AND class_id = $3`, [id, auth.userId, auth.classId])
    }
    return { saved: parsed.data.saved }
  })

  app.post('/api/v1/tree/:id/identity', async (request) => {
    const auth = app.requireAuth(request)
    if (auth.role !== 'super_admin') {
      throw ApiError.forbidden('tree_identity_forbidden', '只有总管理员可以查看真实身份')
    }
    const { id } = request.params as { id: string }
    return withTransaction(async (tx: Tx) => {
      const row = await tx.queryOne<{ author_enc: unknown }>(
        `SELECT tim.author_enc FROM tree_identity_map tim
         JOIN tree_posts tp ON tp.id = tim.post_id AND tp.class_id = tim.class_id
         WHERE tim.post_id = $1 AND tim.class_id = $2`,
        [id, auth.classId],
      )
      if (!row) throw ApiError.notFound('tree_post_not_found', '树洞内容不存在')
      if (!isSealedValue(row.author_enc)) throw new Error('invalid encrypted tree identity')
      const userId = app.config.security.encryption.openString(row.author_enc, `tree:post:${id}`)
      const member = await tx.queryOne<{ real_name: string; student_number: string | null }>(
        `SELECT real_name, student_number FROM class_members WHERE class_id = $1 AND user_id = $2`,
        [auth.classId, userId],
      )
      if (!member) throw ApiError.notFound('tree_author_not_found', '作者账号不存在')
      const revealedAt = new Date()
      const auditId = await writeAudit(tx, {
        classId: auth.classId,
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'tree.identity_reveal',
        targetType: 'tree_post',
        targetId: id,
        afterState: { revealedUserId: userId },
        sessionId: auth.sessionId,
        requestId: requestId(request),
        ipHmac: request.ipHmac,
      })
      return {
        postId: id,
        userId,
        realName: member.real_name,
        studentNumber: member.student_number ?? '',
        revealedAt: revealedAt.toISOString(),
        auditId,
      }
    })
  })
}
