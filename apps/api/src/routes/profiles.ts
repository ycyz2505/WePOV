import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getPool } from '@wepov/database'
import { isSealedValue } from '@wepov/security'
import { ApiError, validationError } from '../errors.js'
import { updateProfileSchema } from '../schemas.js'
import { clampLimit, decodeCursor, encodeCursor } from '../lib/cursor.js'
import { pinyinInitials } from '../lib/pinyin.js'

const listQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  sort: z.enum(['recent', 'nickname', 'likes', 'followers']).default('recent'),
  filter: z.enum(['all', 'following', 'followers', 'mutual', 'not_following']).default('all'),
  gender: z.string().trim().max(20).optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

const userParamsSchema = z.object({ userId: z.string().uuid() })
const cursorQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

const profileAssetSchema = z.object({
  kind: z.enum(['avatar', 'background']),
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  dataBase64: z.string().min(16).max(400_000),
})

/** Sniff the container from the first bytes; the declared MIME must match. */
function magicMatches(mime: string, bytes: Buffer): boolean {
  if (mime === 'image/jpeg') return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (mime === 'image/png') {
    return bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  }
  if (mime === 'image/webp') {
    return (
      bytes.length > 12 &&
      bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
      bytes.subarray(8, 12).toString('latin1') === 'WEBP'
    )
  }
  return false
}

type SortKind = 'recent' | 'nickname' | 'likes' | 'followers'

interface ProfileRow {
  user_id: string
  nickname: string
  nickname_pinyin: string
  real_name: string
  real_name_pinyin: string
  gender: string
  birthday_enc: unknown
  birthday_visible: boolean
  signature: string
  introduction: string
  avatar_object_key: string | null
  background_object_key: string | null
  following_count: number
  follower_count: number
  like_count: number
  is_following: boolean
  is_mutual: boolean
  updated_at: Date
  sort_key?: Date | string | number
}

interface FollowRow {
  relation_id: string
  relation_at: Date
  user_id: string
  nickname: string
  real_name: string
  gender: string
  avatar_object_key: string | null
  is_following: boolean
  is_mutual: boolean
}

function birthdayFor(app: FastifyInstance, row: ProfileRow, viewerId: string): string | null {
  if (viewerId !== row.user_id && !row.birthday_visible) return null
  if (!isSealedValue(row.birthday_enc)) return null
  try {
    return app.config.security.encryption.openString(row.birthday_enc, `profile:birthday:${row.user_id}`)
  } catch {
    return null
  }
}

async function objectUrl(app: FastifyInstance, key: string | null): Promise<string | null> {
  if (!key || !app.u3.configured) return null
  try {
    return await app.u3.presignGet({ bucket: app.u3.buckets.media, key })
  } catch {
    return null
  }
}

async function profileDto(app: FastifyInstance, row: ProfileRow, viewerId: string) {
  const [avatarUrl, backgroundUrl] = await Promise.all([
    objectUrl(app, row.avatar_object_key),
    objectUrl(app, row.background_object_key),
  ])
  return {
    userId: row.user_id,
    nickname: row.nickname,
    realName: row.real_name,
    gender: row.gender,
    birthday: birthdayFor(app, row, viewerId),
    birthdayVisible: row.birthday_visible,
    signature: row.signature,
    introduction: row.introduction,
    avatarUrl,
    backgroundUrl,
    followingCount: row.following_count,
    followerCount: row.follower_count,
    likeCount: row.like_count,
    isFollowing: row.is_following,
    isMutual: row.is_mutual,
    updatedAt: row.updated_at.toISOString(),
    pinyinInitials: pinyinInitials(row.real_name_pinyin, row.nickname_pinyin),
    backgroundPreset: null,
  }
}

async function followDto(app: FastifyInstance, row: FollowRow) {
  return {
    userId: row.user_id,
    nickname: row.nickname,
    realName: row.real_name,
    avatarUrl: await objectUrl(app, row.avatar_object_key),
    gender: row.gender,
    isFollowing: row.is_following,
    isMutual: row.is_mutual,
  }
}

function cursorKey(row: ProfileRow, sort: SortKind): string {
  if (sort === 'recent') return (row.sort_key as Date).toISOString()
  return String(row.sort_key ?? '')
}

const PROFILE_SELECT = `
  SELECT p.user_id, p.nickname, p.nickname_pinyin,
         cm.real_name, cm.real_name_pinyin, cm.gender,
         p.birthday_enc, p.birthday_visible, p.signature, p.introduction,
         p.avatar_object_key, p.background_object_key,
         p.following_count, p.follower_count, p.like_count, p.updated_at,
         EXISTS (
           SELECT 1 FROM follows vf
            WHERE vf.class_id = p.class_id AND vf.follower_id = $2 AND vf.followee_id = p.user_id
         ) AS is_following,
         EXISTS (
           SELECT 1 FROM follows vf
           JOIN follows rv ON rv.class_id = vf.class_id
             AND rv.follower_id = vf.followee_id AND rv.followee_id = vf.follower_id
            WHERE vf.class_id = p.class_id AND vf.follower_id = $2 AND vf.followee_id = p.user_id
         ) AS is_mutual
    FROM profiles p
    JOIN class_members cm ON cm.class_id = p.class_id AND cm.user_id = p.user_id
    JOIN users u ON u.id = p.user_id
`

async function loadProfile(app: FastifyInstance, classId: string, viewerId: string, userId: string) {
  const result = await getPool().query<ProfileRow>(
    `${PROFILE_SELECT}
      WHERE p.class_id = $1 AND p.user_id = $3
        AND u.is_active = true AND u.deleted_at IS NULL
        AND (cm.hidden = false OR p.user_id = $2)`,
    [classId, viewerId, userId],
  )
  const row = result.rows[0]
  if (!row) throw ApiError.notFound('profile_not_found', '没有找到这位同学')
  return profileDto(app, row, viewerId)
}

export const profileRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/profiles', async (request) => {
    const auth = app.requireAuth(request)
    const parsed = listQuerySchema.safeParse(request.query)
    if (!parsed.success) throw validationError(parsed.error.issues)
    const { q, sort, filter, gender } = parsed.data
    const limit = clampLimit(parsed.data.limit)
    const cursor = decodeCursor(parsed.data.cursor)
    if (parsed.data.cursor && !cursor) throw ApiError.badRequest('invalid_cursor', '分页游标无效')

    const sortExpression: Record<SortKind, string> = {
      recent: 'p.updated_at',
      nickname: 'p.nickname_norm',
      likes: 'p.like_count',
      followers: 'p.follower_count',
    }
    const order: Record<SortKind, string> = {
      recent: 'p.updated_at DESC, p.user_id DESC',
      nickname: 'p.nickname_norm ASC, p.user_id ASC',
      likes: 'p.like_count DESC, p.user_id DESC',
      followers: 'p.follower_count DESC, p.user_id DESC',
    }

    const params: unknown[] = [auth.classId, auth.userId]
    const where = [
      'p.class_id = $1',
      'u.is_active = true',
      'u.deleted_at IS NULL',
      '(cm.hidden = false OR p.user_id = $2)',
    ]
    if (q && q.length > 0) {
      params.push(`%${q.toLocaleLowerCase('zh-CN')}%`)
      const n = params.length
      where.push(`(
        lower(p.nickname) LIKE $${n} OR lower(cm.real_name) LIKE $${n}
        OR lower(replace(cm.real_name_pinyin, ' ', '')) LIKE $${n}
        OR lower(replace(p.nickname_pinyin, ' ', '')) LIKE $${n}
        OR lower(regexp_replace(cm.real_name_pinyin,
             '(^|[[:space:]-]+)([^[:space:]-])[^[:space:]-]*', '\\2', 'g')) LIKE $${n}
        OR lower(regexp_replace(p.nickname_pinyin,
             '(^|[[:space:]-]+)([^[:space:]-])[^[:space:]-]*', '\\2', 'g')) LIKE $${n}
      )`)
    }
    if (gender && gender.length > 0) {
      params.push(gender)
      where.push(`cm.gender = $${params.length}`)
    }
    if (filter === 'following' || filter === 'mutual') {
      where.push(`EXISTS (SELECT 1 FROM follows f WHERE f.class_id = p.class_id AND f.follower_id = $2 AND f.followee_id = p.user_id)`)
    }
    if (filter === 'followers' || filter === 'mutual') {
      where.push(`EXISTS (SELECT 1 FROM follows f WHERE f.class_id = p.class_id AND f.follower_id = p.user_id AND f.followee_id = $2)`)
    }
    if (filter === 'not_following') {
      where.push(`p.user_id <> $2 AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.class_id = p.class_id AND f.follower_id = $2 AND f.followee_id = p.user_id)`)
    }
    if (cursor) {
      let cursorValue: string | number = cursor.k
      if (sort === 'likes' || sort === 'followers') {
        const numeric = Number(cursor.k)
        if (!Number.isFinite(numeric)) {
          throw ApiError.badRequest('invalid_cursor', '分页游标无效')
        }
        cursorValue = numeric
      } else if (sort === 'recent' && !Number.isFinite(Date.parse(cursor.k))) {
        throw ApiError.badRequest('invalid_cursor', '分页游标无效')
      }
      params.push(cursorValue, cursor.i)
      const keyPos = params.length - 1
      const operator = sort === 'nickname' ? '>' : '<'
      where.push(`(${sortExpression[sort]}, p.user_id) ${operator} ($${keyPos}, $${keyPos + 1})`)
    }
    params.push(limit + 1)

    const result = await getPool().query<ProfileRow>(
      `SELECT p.user_id, p.nickname, p.nickname_pinyin,
              cm.real_name, cm.real_name_pinyin, cm.gender,
              p.birthday_enc, p.birthday_visible, p.signature, p.introduction,
              p.avatar_object_key, p.background_object_key,
              p.following_count, p.follower_count, p.like_count, p.updated_at,
              ${sortExpression[sort]} AS sort_key,
              EXISTS (SELECT 1 FROM follows vf WHERE vf.class_id = p.class_id AND vf.follower_id = $2 AND vf.followee_id = p.user_id) AS is_following,
              EXISTS (
                SELECT 1 FROM follows vf
                JOIN follows rv ON rv.class_id = vf.class_id AND rv.follower_id = vf.followee_id AND rv.followee_id = vf.follower_id
                 WHERE vf.class_id = p.class_id AND vf.follower_id = $2 AND vf.followee_id = p.user_id
              ) AS is_mutual
         FROM profiles p
         JOIN class_members cm ON cm.class_id = p.class_id AND cm.user_id = p.user_id
         JOIN users u ON u.id = p.user_id
        WHERE ${where.join(' AND ')}
        ORDER BY ${order[sort]}
        LIMIT $${params.length}`,
      params,
    )
    const hasMore = result.rows.length > limit
    const rows = result.rows.slice(0, limit)
    return {
      items: await Promise.all(rows.map((row) => profileDto(app, row, auth.userId))),
      nextCursor: hasMore && rows.length > 0
        ? encodeCursor({ k: cursorKey(rows[rows.length - 1]!, sort), i: rows[rows.length - 1]!.user_id })
        : null,
    }
  })

  app.get('/api/v1/profiles/me', async (request) => {
    const auth = app.requireAuth(request)
    return loadProfile(app, auth.classId, auth.userId, auth.userId)
  })

  app.patch('/api/v1/profiles/me', async (request) => {
    const auth = app.requireAuth(request)
    const parsed = updateProfileSchema.safeParse(request.body)
    if (!parsed.success) throw validationError(parsed.error.issues)
    const input = parsed.data
    const ownPrefix = `profiles/${auth.classId}/${auth.userId}/`
    if (input.avatarObjectKey && !input.avatarObjectKey.startsWith(ownPrefix)) {
      throw ApiError.badRequest('invalid_object_key', '头像文件无效')
    }
    if (input.backgroundObjectKey && !input.backgroundObjectKey.startsWith(ownPrefix)) {
      throw ApiError.badRequest('invalid_object_key', '背景文件无效')
    }
    const sets: string[] = []
    const params: unknown[] = []
    const set = (sql: string, value: unknown) => {
      params.push(value)
      sets.push(`${sql} = $${params.length}`)
    }
    if (input.nickname !== undefined) {
      set('nickname', input.nickname)
      set('nickname_norm', input.nickname.normalize('NFKC').toLocaleLowerCase('zh-CN'))
    }
    if (input.birthday !== undefined) {
      const sealed = input.birthday === null
        ? null
        : app.config.security.encryption.seal(input.birthday, `profile:birthday:${auth.userId}`)
      set('birthday_enc', sealed === null ? null : JSON.stringify(sealed))
    }
    if (input.birthdayVisible !== undefined) set('birthday_visible', input.birthdayVisible)
    if (input.signature !== undefined) set('signature', input.signature)
    if (input.introduction !== undefined) set('introduction', input.introduction)
    if (input.avatarObjectKey !== undefined) set('avatar_object_key', input.avatarObjectKey)
    if (input.backgroundObjectKey !== undefined) set('background_object_key', input.backgroundObjectKey)

    if (sets.length > 0) {
      params.push(auth.userId, auth.classId)
      try {
        await getPool().query(
          `UPDATE profiles SET ${sets.join(', ')}, version = version + 1
            WHERE user_id = $${params.length - 1} AND class_id = $${params.length}`,
          params,
        )
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          throw ApiError.conflict('nickname_taken', '这个昵称已被使用')
        }
        throw error
      }
    }
    return loadProfile(app, auth.classId, auth.userId, auth.userId)
  })

  // Avatar and background are small (≤40 KB / ≤120 KB), so they are uploaded
  // inline instead of going through the album upload pipeline. They live under
  // the caller's own prefix, which PATCH /profiles/me then verifies.
  app.post('/api/v1/profiles/me/assets', async (request, reply) => {
    const auth = app.requireAuth(request)
    const parsed = profileAssetSchema.safeParse(request.body)
    if (!parsed.success) throw validationError(parsed.error.issues)
    const { kind, mime, dataBase64 } = parsed.data

    if (!app.u3.configured) throw ApiError.serviceUnavailable('图片存储暂不可用', 30)

    const bytes = Buffer.from(dataBase64, 'base64')
    const limit = kind === 'avatar' ? 64 * 1024 : 160 * 1024
    if (bytes.length === 0 || bytes.length > limit) {
      throw ApiError.badRequest('asset_too_large', kind === 'avatar' ? '头像过大' : '背景过大')
    }
    if (!magicMatches(mime, bytes)) {
      throw ApiError.badRequest('asset_invalid', '图片格式不正确')
    }

    const ext = mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'webp'
    const key = `profiles/${auth.classId}/${auth.userId}/${kind}-${randomUUID()}.${ext}`
    await app.u3.putObject(app.u3.buckets.media, key, bytes, mime)
    reply.status(201)
    return {
      objectKey: key,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }
  })

  app.get('/api/v1/profiles/:userId', async (request) => {
    const auth = app.requireAuth(request)
    const parsed = userParamsSchema.safeParse(request.params)
    if (!parsed.success) throw validationError(parsed.error.issues)
    return loadProfile(app, auth.classId, auth.userId, parsed.data.userId)
  })

  const registerFollowList = (kind: 'followers' | 'following' | 'likes') => {
    app.get(`/api/v1/profiles/:userId/${kind}`, async (request) => {
      const auth = app.requireAuth(request)
      const path = userParamsSchema.safeParse(request.params)
      const query = cursorQuerySchema.safeParse(request.query)
      if (!path.success) throw validationError(path.error.issues)
      if (!query.success) throw validationError(query.error.issues)
      const targetId = path.data.userId
      const limit = clampLimit(query.data.limit)
      const cursor = decodeCursor(query.data.cursor)
      if (query.data.cursor && !cursor) throw ApiError.badRequest('invalid_cursor', '分页游标无效')

      const target = await getPool().query(
        `SELECT 1 FROM profiles p
          JOIN class_members cm ON cm.class_id = p.class_id AND cm.user_id = p.user_id
          JOIN users u ON u.id = p.user_id
         WHERE p.class_id = $1 AND p.user_id = $2 AND u.is_active = true AND u.deleted_at IS NULL
           AND (cm.hidden = false OR p.user_id = $3)`,
        [auth.classId, targetId, auth.userId],
      )
      if (!target.rows[0]) throw ApiError.notFound('profile_not_found', '没有找到这位同学')

      const params: unknown[] = [auth.classId, targetId, auth.userId]
      let relationSource: string
      let relationUser: string
      if (kind === 'following') {
        relationSource = 'follows r'
        relationUser = 'r.followee_id'
      } else if (kind === 'followers') {
        relationSource = 'follows r'
        relationUser = 'r.follower_id'
      } else {
        relationSource = `(SELECT class_id, liker_id AS user_id, max(created_at) AS created_at,
                                  max(id::text) AS id
                             FROM profile_likes
                            WHERE class_id = $1 AND target_user_id = $2
                            GROUP BY class_id, liker_id) r`
        relationUser = 'r.user_id'
      }
      if (cursor) {
        params.push(cursor.k, cursor.i)
      }
      params.push(limit + 1)
      const cursorClause = cursor ? `AND (r.created_at, r.id) < ($4, $5)` : ''
      const rows = await getPool().query<FollowRow>(
        `SELECT r.id AS relation_id, r.created_at AS relation_at,
                p.user_id, p.nickname, cm.real_name, cm.gender, p.avatar_object_key,
                EXISTS (SELECT 1 FROM follows mine WHERE mine.class_id = $1 AND mine.follower_id = $3 AND mine.followee_id = p.user_id) AS is_following,
                EXISTS (
                  SELECT 1 FROM follows mine
                  JOIN follows reverse ON reverse.class_id = mine.class_id AND reverse.follower_id = mine.followee_id AND reverse.followee_id = mine.follower_id
                   WHERE mine.class_id = $1 AND mine.follower_id = $3 AND mine.followee_id = p.user_id
                ) AS is_mutual
           FROM ${relationSource}
           JOIN profiles p ON p.class_id = r.class_id AND p.user_id = ${relationUser}
           JOIN class_members cm ON cm.class_id = p.class_id AND cm.user_id = p.user_id
           JOIN users u ON u.id = p.user_id
          WHERE r.class_id = $1
            ${kind === 'following' ? 'AND r.follower_id = $2' : kind === 'followers' ? 'AND r.followee_id = $2' : ''}
            AND u.is_active = true AND u.deleted_at IS NULL AND cm.hidden = false
            ${cursorClause}
          ORDER BY r.created_at DESC, r.id DESC
          LIMIT $${params.length}`,
        params,
      )
      const hasMore = rows.rows.length > limit
      const visible = rows.rows.slice(0, limit)
      return {
        items: await Promise.all(visible.map((row) => followDto(app, row))),
        nextCursor: hasMore && visible.length > 0
          ? encodeCursor({ k: visible[visible.length - 1]!.relation_at.toISOString(), i: visible[visible.length - 1]!.relation_id })
          : null,
      }
    })
  }

  registerFollowList('followers')
  registerFollowList('following')
  registerFollowList('likes')
}
