import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify'
import { getPool } from '@wepov/database'
import { isSealedValue } from '@wepov/security'
import { ApiError, validationError } from '../errors.js'
import { capsuleContributionSchema, capsuleCreateSchema, capsuleDelaySchema } from '../schemas.js'
import { clampLimit, decodeCursor, encodeCursor } from '../lib/cursor.js'
import { avatarUrl, mediaUrls } from '../lib/urls.js'

interface CapsuleRow {
  id: string
  class_id: string
  author_id: string
  title: string
  content_plain: string | null
  content_enc: unknown
  visibility: 'class' | 'recipient' | 'self' | 'collaborative'
  unlock_at: Date
  contribution_deadline: Date
  sealed_at: Date | null
  media_object_keys: string[]
  unlocked_at: Date | null
  created_at: Date
  contributor_count: string
  recipient_count: string
  can_contribute: boolean
}

interface PersonRow {
  user_id: string
  nickname: string
  avatar_object_key: string | null
}

function params(request: FastifyRequest): Record<string, string> {
  return request.params as Record<string, string>
}

function query(request: FastifyRequest): Record<string, string | undefined> {
  return request.query as Record<string, string | undefined>
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function summary(row: CapsuleRow) {
  const now = Date.now()
  return {
    id: row.id,
    title: row.title,
    visibility: row.visibility,
    unlockAt: row.unlock_at.toISOString(),
    contributionDeadline: row.contribution_deadline.toISOString(),
    locked: row.unlock_at.getTime() > now,
    contributorCount: Number(row.contributor_count),
    recipientCount: Number(row.recipient_count),
    createdAt: row.created_at.toISOString(),
    canContribute: row.can_contribute && row.contribution_deadline.getTime() > now,
  }
}

async function sealDueCapsules(app: FastifyInstance, classId: string): Promise<void> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const due = await client.query<{
      id: string
      content_plain: string
    }>(
      `SELECT id, content_plain FROM time_capsules
        WHERE class_id = $1 AND sealed_at IS NULL AND contribution_deadline <= now()
        FOR UPDATE SKIP LOCKED`,
      [classId],
    )
    for (const capsule of due.rows) {
      const sealed = app.config.security.encryption.seal(
        capsule.content_plain,
        `capsule:${capsule.id}:content`,
      )
      await client.query(
        `UPDATE time_capsules
            SET content_plain = NULL, content_enc = $2, sealed_at = now(), key_version = $3
          WHERE id = $1`,
        [capsule.id, JSON.stringify(sealed), sealed.v],
      )
      const contributions = await client.query<{
        user_id: string
        contribution_plain: string
      }>(
        `SELECT user_id, contribution_plain FROM capsule_contributors
          WHERE capsule_id = $1 AND contribution_plain IS NOT NULL
          FOR UPDATE`,
        [capsule.id],
      )
      for (const contribution of contributions.rows) {
        const encrypted = app.config.security.encryption.seal(
          contribution.contribution_plain,
          `capsule:${capsule.id}:contributor:${contribution.user_id}`,
        )
        await client.query(
          `UPDATE capsule_contributors
              SET contribution_plain = NULL, contribution_enc = $3, key_version = $4
            WHERE capsule_id = $1 AND user_id = $2`,
          [capsule.id, contribution.user_id, JSON.stringify(encrypted), encrypted.v],
        )
      }
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const CAPSULE_SELECT = `
  SELECT c.id, c.class_id, c.author_id, c.title, c.content_plain, c.content_enc,
         c.visibility, c.unlock_at, c.contribution_deadline, c.sealed_at,
         c.media_object_keys, c.unlocked_at, c.created_at,
         (SELECT count(*)::text FROM capsule_contributors cc
           WHERE cc.capsule_id = c.id AND cc.submitted_at IS NOT NULL) AS contributor_count,
         (SELECT count(*)::text FROM capsule_recipients cr
           WHERE cr.capsule_id = c.id) AS recipient_count,
         EXISTS (SELECT 1 FROM capsule_contributors mine
           WHERE mine.capsule_id = c.id AND mine.user_id = $2) AS can_contribute
    FROM time_capsules c
`

function visibilityWhere(): string {
  return `c.class_id = $1 AND (
    c.author_id = $2 OR c.visibility = 'class' OR
    (c.visibility IN ('recipient','collaborative') AND EXISTS (
      SELECT 1 FROM capsule_recipients visible_to
       WHERE visible_to.capsule_id = c.id AND visible_to.user_id = $2
    ))
  )`
}

async function validateMediaKeys(classId: string, keys: string[]): Promise<void> {
  const unique = [...new Set(keys)]
  if (unique.length === 0) return
  const result = await getPool().query<{ object_key: string }>(
    `SELECT object_key FROM media_objects
      WHERE class_id = $1 AND object_key = ANY($2::text[]) AND status = 'active'`,
    [classId, unique],
  )
  if (result.rows.length !== unique.length) {
    throw ApiError.badRequest('invalid_media', '时间胶囊包含无效或无权访问的媒体文件')
  }
}

async function people(app: FastifyInstance, rows: PersonRow[]) {
  return Promise.all(
    rows.map(async (row) => ({
      userId: row.user_id,
      nickname: row.nickname,
      avatarUrl: await avatarUrl(app, row.avatar_object_key),
    })),
  )
}

export const capsuleRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/capsules', async (request) => {
    const auth = app.requireAuth(request)
    await sealDueCapsules(app, auth.classId)
    const q = query(request)
    const cursor = decodeCursor(q['cursor'])
    if (q['cursor'] && !cursor) throw ApiError.badRequest('invalid_cursor', '分页游标不合法')
    const limit = clampLimit(q['limit'] ? Number(q['limit']) : undefined)
    const result = await getPool().query<CapsuleRow>(
      `${CAPSULE_SELECT}
        WHERE ${visibilityWhere()}
          AND ($3::timestamptz IS NULL OR (c.created_at, c.id) < ($3, $4::uuid))
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT $5`,
      [auth.classId, auth.userId, cursor?.k ?? null, cursor?.i ?? null, limit + 1],
    )
    const hasMore = result.rows.length > limit
    const rows = result.rows.slice(0, limit)
    const last = rows.at(-1)
    return {
      items: rows.map(summary),
      nextCursor:
        hasMore && last ? encodeCursor({ k: last.created_at.toISOString(), i: last.id }) : null,
    }
  })

  app.get('/api/v1/capsules/:id', async (request) => {
    const auth = app.requireAuth(request)
    const capsuleId = params(request)['id']
    if (!capsuleId || !isUuid(capsuleId)) throw ApiError.notFound('capsule_not_found', '时间胶囊不存在')
    await sealDueCapsules(app, auth.classId)

    const result = await getPool().query<CapsuleRow>(
      `${CAPSULE_SELECT} WHERE ${visibilityWhere()} AND c.id = $3`,
      [auth.classId, auth.userId, capsuleId],
    )
    const row = result.rows[0]
    if (!row) throw ApiError.notFound('capsule_not_found', '时间胶囊不存在')

    const locked = row.unlock_at.getTime() > Date.now()
    let content: string | null = null
    if (!locked) {
      if (row.content_plain !== null) {
        content = row.content_plain
      } else if (isSealedValue(row.content_enc)) {
        content = app.config.security.encryption.openString(
          row.content_enc,
          `capsule:${row.id}:content`,
        )
      }
      if (!row.unlocked_at) {
        void getPool()
          .query('UPDATE time_capsules SET unlocked_at = now() WHERE id = $1 AND unlocked_at IS NULL', [row.id])
          .catch(() => undefined)
      }
    }

    const [contributorResult, recipientResult] = await Promise.all([
      getPool().query<PersonRow>(
        `SELECT cc.user_id, p.nickname, p.avatar_object_key
           FROM capsule_contributors cc JOIN profiles p ON p.user_id = cc.user_id
          WHERE cc.capsule_id = $1 AND cc.class_id = $2
          ORDER BY cc.created_at, cc.user_id`,
        [row.id, auth.classId],
      ),
      getPool().query<PersonRow>(
        `SELECT cr.user_id, p.nickname, p.avatar_object_key
           FROM capsule_recipients cr JOIN profiles p ON p.user_id = cr.user_id
          WHERE cr.capsule_id = $1 AND cr.class_id = $2
          ORDER BY cr.created_at, cr.user_id`,
        [row.id, auth.classId],
      ),
    ])

    const media = locked
      ? []
      : await Promise.all(
          row.media_object_keys.map(async (key) => {
            const urls = await mediaUrls(app, key)
            return urls.previewUrl ?? urls.downloadUrl
          }),
        )

    return {
      ...summary(row),
      content,
      contributors: await people(app, contributorResult.rows),
      recipients: await people(app, recipientResult.rows),
      mediaUrls: media.filter((url): url is string => url !== null),
    }
  })

  app.post('/api/v1/capsules', async (request, reply) => {
    const auth = app.requireAuth(request)
    const parsed = capsuleCreateSchema.safeParse(request.body)
    if (!parsed.success) throw validationError(parsed.error.issues)
    const data = parsed.data
    const unlockAt = new Date(data.unlockAt)
    const contributionDeadline = new Date(data.contributionDeadline)
    const now = Date.now()
    if (unlockAt.getTime() <= now) {
      throw ApiError.badRequest('invalid_unlock_time', '解锁时间必须晚于现在')
    }
    if (
      contributionDeadline.getTime() <= now ||
      contributionDeadline.getTime() > unlockAt.getTime()
    ) {
      throw ApiError.badRequest('invalid_contribution_deadline', '征集截止时间必须晚于现在且不晚于解锁时间')
    }

    const suppliedRecipientIds = [...new Set(data.recipientIds)].filter((id) => id !== auth.userId)
    const recipientIds =
      data.visibility === 'recipient' || data.visibility === 'collaborative'
        ? suppliedRecipientIds
        : []
    await validateMediaKeys(auth.classId, data.mediaObjectKeys)
    if ((data.visibility === 'recipient' || data.visibility === 'collaborative') && recipientIds.length === 0) {
      throw ApiError.badRequest('recipients_required', '请选择至少一位同学')
    }
    if (recipientIds.length > 0) {
      const members = await getPool().query<{ id: string }>(
        `SELECT u.id FROM users u
          JOIN class_members cm ON cm.user_id = u.id
         WHERE cm.class_id = $1 AND u.id = ANY($2::uuid[])
           AND u.is_active = true AND u.deleted_at IS NULL`,
        [auth.classId, recipientIds],
      )
      if (members.rows.length !== recipientIds.length) {
        throw ApiError.badRequest('invalid_recipients', '收件人中包含无效成员')
      }
    }

    const client = await getPool().connect()
    try {
      await client.query('BEGIN')
      const inserted = await client.query<CapsuleRow>(
        `INSERT INTO time_capsules
           (class_id, author_id, title, content_plain, visibility, unlock_at,
            contribution_deadline, media_object_keys)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id, class_id, author_id, title, content_plain, content_enc,
                   visibility, unlock_at, contribution_deadline, sealed_at,
                   media_object_keys, unlocked_at, created_at,
                   '0'::text AS contributor_count,
                   '0'::text AS recipient_count,
                   ($5 = 'collaborative')::boolean AS can_contribute`,
        [
          auth.classId,
          auth.userId,
          data.title,
          data.content,
          data.visibility,
          unlockAt,
          contributionDeadline,
          data.mediaObjectKeys,
        ],
      )
      if (recipientIds.length > 0) {
        await client.query(
          `INSERT INTO capsule_recipients (capsule_id, class_id, user_id)
           SELECT $1, $2, unnest($3::uuid[])`,
          [inserted.rows[0]!.id, auth.classId, recipientIds],
        )
      }
      if (data.visibility === 'collaborative') {
        const contributors = [...new Set([auth.userId, ...recipientIds])]
        await client.query(
          `INSERT INTO capsule_contributors (capsule_id, class_id, user_id)
           SELECT $1, $2, unnest($3::uuid[])`,
          [inserted.rows[0]!.id, auth.classId, contributors],
        )
      }
      await client.query('COMMIT')
      const row = inserted.rows[0]!
      row.recipient_count = String(recipientIds.length)
      reply.status(201)
      return summary(row)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  })

  app.post('/api/v1/capsules/:id/contributions', async (request) => {
    const auth = app.requireAuth(request)
    const parsed = capsuleContributionSchema.safeParse(request.body)
    if (!parsed.success) throw validationError(parsed.error.issues)
    const capsuleId = params(request)['id']
    if (!capsuleId || !isUuid(capsuleId)) throw ApiError.notFound('capsule_not_found', '时间胶囊不存在')
    await validateMediaKeys(auth.classId, parsed.data.mediaObjectKeys)

    const client = await getPool().connect()
    try {
      await client.query('BEGIN')
      const capsule = await client.query<CapsuleRow>(
        `${CAPSULE_SELECT}
          WHERE c.id = $3 AND c.class_id = $1 AND c.visibility = 'collaborative'
          FOR UPDATE OF c`,
        [auth.classId, auth.userId, capsuleId],
      )
      const row = capsule.rows[0]
      if (!row) throw ApiError.notFound('capsule_not_found', '协作时间胶囊不存在')
      if (row.sealed_at || row.contribution_deadline.getTime() <= Date.now()) {
        throw ApiError.conflict('capsule_sealed', '征集已经截止')
      }
      const contributor = await client.query<{ submitted_at: Date | null }>(
        `SELECT submitted_at FROM capsule_contributors
          WHERE capsule_id = $1 AND class_id = $2 AND user_id = $3 FOR UPDATE`,
        [row.id, auth.classId, auth.userId],
      )
      const contributorRow = contributor.rows[0]
      if (!contributorRow) throw ApiError.forbidden('not_contributor', '你不是这个胶囊的协作者')

      const mergedKeys = [...new Set([...row.media_object_keys, ...parsed.data.mediaObjectKeys])]
      if (mergedKeys.length > 20) {
        throw ApiError.badRequest('too_many_media', '时间胶囊最多包含 20 个媒体文件')
      }
      await client.query(
        `UPDATE capsule_contributors
            SET contribution_plain = $4, contribution_enc = NULL, submitted_at = now()
          WHERE capsule_id = $1 AND class_id = $2 AND user_id = $3`,
        [row.id, auth.classId, auth.userId, parsed.data.content],
      )
      await client.query(
        'UPDATE time_capsules SET media_object_keys = $2 WHERE id = $1',
        [row.id, mergedKeys],
      )
      await client.query('COMMIT')
      row.media_object_keys = mergedKeys
      if (!contributorRow.submitted_at) {
        row.contributor_count = String(Number(row.contributor_count) + 1)
      }
      return summary(row)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  })

  app.patch('/api/v1/capsules/:id/unlock-at', async (request) => {
    const auth = app.requireAuth(request)
    const parsed = capsuleDelaySchema.safeParse(request.body)
    if (!parsed.success) throw validationError(parsed.error.issues)
    const capsuleId = params(request)['id']
    if (!capsuleId || !isUuid(capsuleId)) throw ApiError.notFound('capsule_not_found', '时间胶囊不存在')
    const unlockAt = new Date(parsed.data.unlockAt)

    const result = await getPool().query<CapsuleRow>(
      `UPDATE time_capsules c
          SET unlock_at = $4
        WHERE c.id = $3 AND c.class_id = $1 AND c.author_id = $2
          AND c.unlocked_at IS NULL AND c.unlock_at > now()
          AND $4 > c.unlock_at AND $4 >= c.contribution_deadline
      RETURNING c.id, c.class_id, c.author_id, c.title, c.content_plain, c.content_enc,
                c.visibility, c.unlock_at, c.contribution_deadline, c.sealed_at,
                c.media_object_keys, c.unlocked_at, c.created_at,
                (SELECT count(*)::text FROM capsule_contributors cc
                  WHERE cc.capsule_id = c.id AND cc.submitted_at IS NOT NULL) AS contributor_count,
                (SELECT count(*)::text FROM capsule_recipients cr
                  WHERE cr.capsule_id = c.id) AS recipient_count,
                EXISTS (SELECT 1 FROM capsule_contributors mine
                  WHERE mine.capsule_id = c.id AND mine.user_id = $2) AS can_contribute`,
      [auth.classId, auth.userId, capsuleId, unlockAt],
    )
    const row = result.rows[0]
    if (!row) throw ApiError.conflict('unlock_time_not_delayed', '只能把未解锁胶囊的解锁时间向后推迟')
    return summary(row)
  })
}
