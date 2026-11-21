import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify'
import { getPool } from '@wepov/database'
import { ApiError, validationError } from '../errors.js'
import {
  downloadSchema,
  folderChangeRequestSchema,
  folderCreateSchema,
  mediaDeleteRequestSchema,
} from '../schemas.js'
import { clampLimit, decodeCursor, encodeCursor } from '../lib/cursor.js'
import { mediaUrls } from '../lib/urls.js'

interface FolderRow {
  id: string
  parent_id: string | null
  name: string
  depth: number
  path: string
  media_count: string
  folder_count: string
  pending_change: 'move' | 'delete' | null
  created_at: Date
}

interface MediaRow {
  id: string
  folder_id: string
  object_key: string
  original_filename: string
  width: number
  height: number
  final_bytes: string
  original_bytes: string
  tier: 'original' | 'high' | 'standard' | 'compact' | 'custom'
  status: 'active' | 'hidden' | 'pending_delete'
  created_at: Date
  uploader_nickname: string
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

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505'
}

function folderDto(row: FolderRow) {
  return {
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    depth: row.depth,
    mediaCount: Number(row.media_count),
    folderCount: Number(row.folder_count),
    pendingChange: row.pending_change,
    createdAt: row.created_at.toISOString(),
  }
}

function reviewState(status: MediaRow['status']): 'approved' | 'pending_delete' | 'hidden' {
  if (status === 'pending_delete') return 'pending_delete'
  if (status === 'hidden') return 'hidden'
  return 'approved'
}

async function mediaDto(app: FastifyInstance, row: MediaRow) {
  const urls = row.status === 'active' ? await mediaUrls(app, row.object_key, row.original_filename) : null
  return {
    id: row.id,
    folderId: row.folder_id,
    filename: row.original_filename,
    width: row.width,
    height: row.height,
    finalBytes: Number(row.final_bytes),
    originalBytes: Number(row.original_bytes),
    tier: row.tier,
    reviewStatus: reviewState(row.status),
    thumbnailUrl: urls?.thumbnailUrl ?? null,
    previewUrl: urls?.previewUrl ?? null,
    downloadUrl: urls?.downloadUrl ?? null,
    uploadedAt: row.created_at.toISOString(),
    uploaderNickname: row.uploader_nickname,
    duplicateOf: null,
  }
}

export const albumRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/albums/folders', async (request) => {
    const auth = app.requireAuth(request)
    const rawParent = query(request)['parentId']
    const parentId = rawParent && rawParent !== 'null' ? rawParent : null
    if (parentId && !isUuid(parentId)) {
      throw ApiError.badRequest('invalid_parent', '文件夹编号不合法')
    }

    if (parentId) {
      const parent = await getPool().query(
        'SELECT 1 FROM album_folders WHERE id = $1 AND class_id = $2',
        [parentId, auth.classId],
      )
      if (!parent.rows[0]) throw ApiError.notFound('folder_not_found', '文件夹不存在')
    }

    const result = await getPool().query<FolderRow>(
      `SELECT f.id, f.parent_id, f.name, f.depth, f.path, f.created_at,
              (SELECT count(*)::text FROM media_objects m
                WHERE m.folder_id = f.id AND m.class_id = $1
                  AND m.status IN ('active','hidden','pending_delete')) AS media_count,
              (SELECT count(*)::text FROM album_folders c
                WHERE c.parent_id = f.id AND c.class_id = $1) AS folder_count,
              (SELECT r.operation FROM folder_change_requests r
                WHERE r.folder_id = f.id AND r.class_id = $1 AND r.status = 'pending'
                ORDER BY r.created_at DESC LIMIT 1) AS pending_change
         FROM album_folders f
        WHERE f.class_id = $1 AND f.parent_id IS NOT DISTINCT FROM $2::uuid
          AND f.name <> '.profile-assets'
        ORDER BY f.name, f.id`,
      [auth.classId, parentId],
    )

    const breadcrumb: Array<{ id: string | null; name: string }> = [{ id: null, name: '全部相册' }]
    if (parentId) {
      const chain = await getPool().query<{ id: string; name: string; depth: number }>(
        `WITH RECURSIVE parents AS (
           SELECT id, parent_id, name, depth
             FROM album_folders WHERE id = $1 AND class_id = $2
           UNION ALL
           SELECT f.id, f.parent_id, f.name, f.depth
             FROM album_folders f JOIN parents p ON p.parent_id = f.id
            WHERE f.class_id = $2
         )
         SELECT id, name, depth FROM parents ORDER BY depth`,
        [parentId, auth.classId],
      )
      breadcrumb.push(...chain.rows.map((row) => ({ id: row.id, name: row.name })))
    }

    return { items: result.rows.map(folderDto), breadcrumb }
  })

  app.post('/api/v1/albums/folders', async (request, reply) => {
    const auth = app.requireAuth(request)
    const parsed = folderCreateSchema.safeParse(request.body)
    if (!parsed.success) throw validationError(parsed.error.issues)
    const { parentId, name } = parsed.data
    if (name === '.profile-assets') {
      throw ApiError.badRequest('reserved_folder_name', '这个文件夹名称不可用')
    }
    const id = randomUUID()
    const client = await getPool().connect()
    try {
      await client.query('BEGIN')
      let parentPath = ''
      if (parentId) {
        const parent = await client.query<{ path: string; depth: number }>(
          'SELECT path, depth FROM album_folders WHERE id = $1 AND class_id = $2 FOR SHARE',
          [parentId, auth.classId],
        )
        const row = parent.rows[0]
        if (!row) throw ApiError.notFound('folder_not_found', '父文件夹不存在')
        if (row.depth >= 10) throw ApiError.badRequest('folder_depth_limit', '文件夹最多十层')
        parentPath = row.path
      }
      const duplicate = await client.query(
        `SELECT 1 FROM album_folders
          WHERE class_id = $1 AND parent_id IS NOT DISTINCT FROM $2::uuid AND name = $3`,
        [auth.classId, parentId, name],
      )
      if (duplicate.rows[0]) throw ApiError.conflict('folder_name_exists', '同级已有同名文件夹')
      const inserted = await client.query<FolderRow>(
        `INSERT INTO album_folders (id, class_id, parent_id, name, path, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, parent_id, name, depth, path, created_at,
                   '0'::text AS media_count, '0'::text AS folder_count,
                   NULL::text AS pending_change`,
        [id, auth.classId, parentId, name, `${parentPath}/${id}`, auth.userId],
      )
      await client.query('COMMIT')
      reply.status(201)
      return folderDto(inserted.rows[0]!)
    } catch (error) {
      await client.query('ROLLBACK')
      if (isUniqueViolation(error)) throw ApiError.conflict('folder_name_exists', '同级已有同名文件夹')
      throw error
    } finally {
      client.release()
    }
  })

  app.post('/api/v1/albums/folders/:id/requests', async (request, reply) => {
    const auth = app.requireAuth(request)
    const parsed = folderChangeRequestSchema.safeParse(request.body)
    if (!parsed.success) throw validationError(parsed.error.issues)
    const folderId = params(request)['id']
    if (!folderId || !isUuid(folderId)) throw ApiError.notFound('folder_not_found', '文件夹不存在')

    const folder = await getPool().query<{ path: string }>(
      'SELECT path FROM album_folders WHERE id = $1 AND class_id = $2',
      [folderId, auth.classId],
    )
    const folderRow = folder.rows[0]
    if (!folderRow) throw ApiError.notFound('folder_not_found', '文件夹不存在')

    let targetParentId: string | null = null
    if (parsed.data.operation === 'move') {
      targetParentId = parsed.data.targetParentId
      if (targetParentId === folderId) {
        throw ApiError.badRequest('folder_cycle', '不能把文件夹移动到自身')
      }
      if (targetParentId) {
        const target = await getPool().query<{ path: string }>(
          'SELECT path FROM album_folders WHERE id = $1 AND class_id = $2',
          [targetParentId, auth.classId],
        )
        const targetRow = target.rows[0]
        if (!targetRow) throw ApiError.notFound('folder_not_found', '目标文件夹不存在')
        if (targetRow.path.startsWith(`${folderRow.path}/`)) {
          throw ApiError.badRequest('folder_cycle', '不能移动到自己的子文件夹')
        }
      }
    }

    try {
      await getPool().query(
        `INSERT INTO folder_change_requests
           (class_id, folder_id, requester_id, operation, target_parent_id, reason)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          auth.classId,
          folderId,
          auth.userId,
          parsed.data.operation,
          targetParentId,
          parsed.data.reason,
        ],
      )
    } catch (error) {
      if (isUniqueViolation(error)) throw ApiError.conflict('request_pending', '已有待审核的文件夹操作')
      throw error
    }
    reply.status(204).send()
  })

  app.get('/api/v1/albums/media', async (request) => {
    const auth = app.requireAuth(request)
    const q = query(request)
    const folderId = q['folderId'] && q['folderId'] !== 'null' ? q['folderId'] : null
    if (folderId && !isUuid(folderId)) throw ApiError.badRequest('invalid_folder', '文件夹编号不合法')
    const cursor = decodeCursor(q['cursor'])
    const limit = clampLimit(q['limit'] ? Number(q['limit']) : undefined)
    if (q['cursor'] && !cursor) throw ApiError.badRequest('invalid_cursor', '分页游标不合法')

    const result = await getPool().query<MediaRow>(
      `SELECT m.id, m.folder_id, m.object_key, m.original_filename, m.width, m.height,
              m.final_bytes::text, m.original_bytes::text, m.tier, m.status, m.created_at,
              p.nickname AS uploader_nickname
         FROM media_objects m
         JOIN profiles p ON p.user_id = m.uploader_id
        WHERE m.class_id = $1
          AND ($2::uuid IS NULL OR m.folder_id = $2)
          AND NOT EXISTS (
            SELECT 1 FROM album_folders hidden_folder
             WHERE hidden_folder.id = m.folder_id AND hidden_folder.name = '.profile-assets'
          )
          AND m.status IN ('active','hidden','pending_delete')
          AND ($3::timestamptz IS NULL OR (m.created_at, m.id) < ($3, $4::uuid))
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT $5`,
      [auth.classId, folderId, cursor?.k ?? null, cursor?.i ?? null, limit + 1],
    )
    const hasMore = result.rows.length > limit
    const rows = result.rows.slice(0, limit)
    const last = rows.at(-1)
    return {
      items: await Promise.all(rows.map((row) => mediaDto(app, row))),
      nextCursor:
        hasMore && last ? encodeCursor({ k: last.created_at.toISOString(), i: last.id }) : null,
    }
  })

  app.post('/api/v1/albums/media/:id/delete-request', async (request, reply) => {
    const auth = app.requireAuth(request)
    const parsed = mediaDeleteRequestSchema.safeParse(request.body)
    if (!parsed.success) throw validationError(parsed.error.issues)
    const mediaId = params(request)['id']
    if (!mediaId || !isUuid(mediaId)) throw ApiError.notFound('media_not_found', '照片不存在')

    const client = await getPool().connect()
    try {
      await client.query('BEGIN')
      const found = await client.query(
        `SELECT 1 FROM media_objects
          WHERE id = $1 AND class_id = $2 AND status IN ('active','hidden') FOR UPDATE`,
        [mediaId, auth.classId],
      )
      if (!found.rows[0]) throw ApiError.notFound('media_not_found', '照片不存在')
      await client.query(
        `INSERT INTO media_delete_requests (class_id, media_id, requester_id, reason)
         VALUES ($1,$2,$3,$4)`,
        [auth.classId, mediaId, auth.userId, parsed.data.reason],
      )
      await client.query(
        `UPDATE media_objects
            SET status = 'pending_delete', hidden_by_request = true
          WHERE id = $1 AND class_id = $2`,
        [mediaId, auth.classId],
      )
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      if (isUniqueViolation(error)) throw ApiError.conflict('request_pending', '这张照片已在等待审核')
      throw error
    } finally {
      client.release()
    }
    reply.status(204).send()
  })

  app.get('/api/v1/albums/storage', async (request) => {
    const auth = app.requireAuth(request)
    const result = await getPool().query<{
      quota_bytes: string
      media_bytes: string
      temp_bytes: string
    }>(
      `SELECT COALESCE(s.quota_bytes, $2)::text AS quota_bytes,
              COALESCE(sum(m.final_bytes) FILTER (WHERE m.status IN ('active','hidden','pending_delete')), 0)::text AS media_bytes,
              COALESCE(sum(m.final_bytes) FILTER (WHERE m.status = 'quarantine'), 0)::text AS temp_bytes
         FROM (SELECT $1::uuid AS class_id) c
         LEFT JOIN storage_usage s ON s.class_id = c.class_id
         LEFT JOIN media_objects m ON m.class_id = c.class_id AND m.status <> 'deleted'
        GROUP BY s.quota_bytes`,
      [auth.classId, app.config.mediaQuotaBytesDefault],
    )
    const row = result.rows[0]!
    const totalBytes = Number(row.quota_bytes)
    const mediaBytes = Number(row.media_bytes)
    const tempBytes = Number(row.temp_bytes)
    const usedBytes = mediaBytes + tempBytes
    const ratio = totalBytes > 0 ? usedBytes / totalBytes : 1
    return {
      totalBytes,
      usedBytes,
      mediaBytes,
      logBytes: 0,
      tempBytes,
      uploadEnabled: app.u3.configured && ratio < 0.95,
      deleteOnly: ratio >= 0.95,
      warning: ratio >= 0.85,
    }
  })

  app.post('/api/v1/albums/download', async (request) => {
    const auth = app.requireAuth(request)
    const parsed = downloadSchema.safeParse(request.body)
    if (!parsed.success) throw validationError(parsed.error.issues)
    if (!app.u3.configured) throw ApiError.serviceUnavailable('照片存储暂不可用', 30)

    const result = await getPool().query<{
      id: string
      object_key: string
      original_filename: string
    }>(
      `SELECT id, object_key, original_filename FROM media_objects
        WHERE class_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`,
      [auth.classId, parsed.data.mediaIds],
    )
    if (result.rows.length !== new Set(parsed.data.mediaIds).size) {
      throw ApiError.notFound('media_not_found', '部分照片不存在或不可下载')
    }
    return {
      items: await Promise.all(
        result.rows.map(async (row) => ({
          id: row.id,
          filename: row.original_filename,
          url: await app.u3.presignGet({
            bucket: app.u3.buckets.media,
            key: row.object_key,
            responseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(row.original_filename)}`,
          }),
        })),
      ),
    }
  })
}
