import { createHash, randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify'
import { getPool } from '@wepov/database'
import { ApiError, validationError } from '../errors.js'
import { uploadIntentSchema } from '../schemas.js'
import { mediaUrls } from '../lib/urls.js'

interface UploadRow {
  id: string
  class_id: string
  folder_id: string
  uploader_id: string
  object_key: string
  original_filename: string
  mime: string
  original_bytes: string
  final_bytes: string
  width: number
  height: number
  sha256: string
  tier: 'original' | 'high' | 'standard' | 'compact' | 'custom'
  status: string
  created_at: Date
  uploader_nickname: string
}

function params(request: FastifyRequest): Record<string, string> {
  return request.params as Record<string, string>
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505'
}

async function ensureProfileFolder(classId: string, userId: string): Promise<string> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`profile-assets:${classId}`])
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM album_folders
        WHERE class_id = $1 AND parent_id IS NULL AND name = '.profile-assets'
        LIMIT 1`,
      [classId],
    )
    if (existing.rows[0]) {
      await client.query('COMMIT')
      return existing.rows[0].id
    }
    const id = randomUUID()
    await client.query(
      `INSERT INTO album_folders (id, class_id, parent_id, name, path, created_by)
       VALUES ($1,$2,NULL,'.profile-assets',$3,$4)`,
      [id, classId, `/${id}`, userId],
    )
    await client.query('COMMIT')
    return id
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function toMediaDto(app: FastifyInstance, row: UploadRow) {
  const urls = await mediaUrls(app, row.object_key, row.original_filename)
  return {
    id: row.id,
    folderId: row.folder_id,
    filename: row.original_filename,
    width: row.width,
    height: row.height,
    finalBytes: Number(row.final_bytes),
    originalBytes: Number(row.original_bytes),
    tier: row.tier,
    reviewStatus: 'approved' as const,
    thumbnailUrl: urls.thumbnailUrl,
    previewUrl: urls.previewUrl,
    downloadUrl: urls.downloadUrl,
    uploadedAt: row.created_at.toISOString(),
    uploaderNickname: row.uploader_nickname,
    duplicateOf: null,
  }
}

export const uploadRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/v1/uploads/intent', async (request, reply) => {
    const auth = app.requireAuth(request)
    if (!app.u3.configured) throw ApiError.serviceUnavailable('照片存储暂不可用', 30)

    const raw =
      typeof request.body === 'object' && request.body !== null
        ? (request.body as Record<string, unknown>)
        : null
    const isProfileAsset = raw?.['folderId'] === 'profile-assets'
    const bodyForValidation = isProfileAsset && raw
      ? { ...raw, folderId: '00000000-0000-4000-8000-000000000000' }
      : request.body
    const parsed = uploadIntentSchema.safeParse(bodyForValidation)
    if (!parsed.success) throw validationError(parsed.error.issues)

    const data = parsed.data
    const folderId = isProfileAsset
      ? await ensureProfileFolder(auth.classId, auth.userId)
      : data.folderId
    if (!isProfileAsset) {
      const folder = await getPool().query(
        'SELECT 1 FROM album_folders WHERE id = $1 AND class_id = $2',
        [folderId, auth.classId],
      )
      if (!folder.rows[0]) throw ApiError.notFound('folder_not_found', '文件夹不存在')
    }

    const sha256 = isProfileAsset
      ? createHash('sha256').update(randomUUID()).digest('hex')
      : data.sha256
    if (!isProfileAsset) {
      const duplicate = await getPool().query<{ id: string }>(
        `SELECT id FROM media_objects
          WHERE class_id = $1 AND sha256 = $2 AND final_bytes = $3 AND status <> 'deleted'
          LIMIT 1`,
        [auth.classId, sha256, data.finalBytes],
      )
      const existing = duplicate.rows[0]
      if (existing) {
        throw ApiError.conflict('media_duplicate', '这张照片已经上传过了', {
          duplicateOf: existing.id,
        })
      }
    }

    const usage = await getPool().query<{ used_bytes: string; quota_bytes: string }>(
      `SELECT COALESCE(sum(m.final_bytes) FILTER (WHERE m.status <> 'deleted'), 0)::text AS used_bytes,
              COALESCE(s.quota_bytes, $2)::text AS quota_bytes
         FROM (SELECT $1::uuid AS class_id) c
         LEFT JOIN storage_usage s ON s.class_id = c.class_id
         LEFT JOIN media_objects m ON m.class_id = c.class_id
        GROUP BY s.quota_bytes`,
      [auth.classId, app.config.mediaQuotaBytesDefault],
    )
    const usageRow = usage.rows[0]!
    if (Number(usageRow.used_bytes) + data.finalBytes > Number(usageRow.quota_bytes)) {
      throw ApiError.conflict('storage_quota_exceeded', '相册空间不足，请先删除照片')
    }

    const uploadId = randomUUID()
    const objectKey = `quarantine/${auth.classId}/${uploadId}`
    try {
      await getPool().query(
        `INSERT INTO media_objects
           (id, class_id, folder_id, uploader_id, object_key, original_filename, mime,
            original_bytes, final_bytes, width, height, sha256, tier,
            preserve_original_bytes, captured_at, status, review_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'quarantine','none')`,
        [
          uploadId,
          auth.classId,
          folderId,
          auth.userId,
          objectKey,
          data.filename,
          data.mime,
          data.originalBytes,
          data.finalBytes,
          data.width,
          data.height,
          sha256,
          data.tier,
          data.preserveOriginalBytes,
          data.capturedAt ? new Date(data.capturedAt) : null,
        ],
      )
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw ApiError.conflict('media_duplicate', '这张照片已经上传过了')
      }
      throw error
    }

    let uploadUrl: string
    try {
      uploadUrl = await app.u3.presignPut({
        bucket: app.u3.buckets.media,
        key: objectKey,
        contentType: data.mime,
        contentLength: data.finalBytes,
      })
    } catch (error) {
      await getPool().query(
        `UPDATE media_objects SET status = 'deleted' WHERE id = $1 AND class_id = $2`,
        [uploadId, auth.classId],
      )
      throw error
    }

    reply.status(201)
    return {
      uploadId,
      objectKey,
      uploadUrl,
      method: 'PUT' as const,
      headers: { 'Content-Type': data.mime },
      expiresAt: new Date(Date.now() + app.config.u3.presignExpirySeconds * 1000).toISOString(),
      quarantine: true,
    }
  })

  app.post('/api/v1/uploads/:id/complete', async (request) => {
    const auth = app.requireAuth(request)
    if (!app.u3.configured) throw ApiError.serviceUnavailable('照片存储暂不可用', 30)
    const uploadId = params(request)['id']
    if (!uploadId || !isUuid(uploadId)) throw ApiError.notFound('upload_not_found', '上传任务不存在')

    const found = await getPool().query<UploadRow>(
      `SELECT m.id, m.class_id, m.folder_id, m.uploader_id, m.object_key,
              m.original_filename, m.mime, m.original_bytes::text, m.final_bytes::text,
              m.width, m.height, m.sha256, m.tier, m.status, m.created_at,
              p.nickname AS uploader_nickname
         FROM media_objects m JOIN profiles p ON p.user_id = m.uploader_id
        WHERE m.id = $1 AND m.class_id = $2 AND m.uploader_id = $3`,
      [uploadId, auth.classId, auth.userId],
    )
    const row = found.rows[0]
    if (!row || row.status !== 'quarantine') {
      throw ApiError.notFound('upload_not_found', '上传任务不存在或已经完成')
    }

    const head = await app.u3.head(app.u3.buckets.media, row.object_key)
    const expectedBytes = Number(row.final_bytes)
    if (!head || head.contentLength !== expectedBytes || head.contentType !== row.mime) {
      await getPool().query(
        `UPDATE media_objects SET status = 'deleted' WHERE id = $1 AND class_id = $2 AND status = 'quarantine'`,
        [row.id, auth.classId],
      )
      void app.u3.deleteObject(app.u3.buckets.media, row.object_key).catch(() => undefined)
      throw ApiError.badRequest('upload_validation_failed', '上传文件的大小或类型与申请不一致')
    }

    const client = await getPool().connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `INSERT INTO storage_usage (class_id, quota_bytes)
         VALUES ($1,$2) ON CONFLICT (class_id) DO NOTHING`,
        [auth.classId, app.config.mediaQuotaBytesDefault],
      )
      const lockedUsage = await client.query<{ used_bytes: string; quota_bytes: string }>(
        'SELECT used_bytes::text, quota_bytes::text FROM storage_usage WHERE class_id = $1 FOR UPDATE',
        [auth.classId],
      )
      const current = lockedUsage.rows[0]!
      if (Number(current.used_bytes) + expectedBytes > Number(current.quota_bytes)) {
        throw ApiError.conflict('storage_quota_exceeded', '相册空间不足，请先删除照片')
      }
      const updated = await client.query<UploadRow>(
        `UPDATE media_objects m
            SET status = 'active', review_status = 'approved'
           FROM profiles p
          WHERE m.id = $1 AND m.class_id = $2 AND m.uploader_id = $3
            AND m.status = 'quarantine' AND p.user_id = m.uploader_id
         RETURNING m.id, m.class_id, m.folder_id, m.uploader_id, m.object_key,
                   m.original_filename, m.mime, m.original_bytes::text, m.final_bytes::text,
                   m.width, m.height, m.sha256, m.tier, m.status, m.created_at,
                   p.nickname AS uploader_nickname`,
        [row.id, auth.classId, auth.userId],
      )
      const completed = updated.rows[0]
      if (!completed) throw ApiError.conflict('upload_already_completed', '上传任务已经处理')
      await client.query(
        'UPDATE storage_usage SET used_bytes = used_bytes + $2, updated_at = now() WHERE class_id = $1',
        [auth.classId, expectedBytes],
      )
      await client.query(
        `INSERT INTO media_hashes (class_id, sha256, size_bytes, media_id)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (class_id, sha256, size_bytes) DO UPDATE SET media_id = EXCLUDED.media_id`,
        [auth.classId, row.sha256, expectedBytes, row.id],
      )
      await client.query('COMMIT')
      return toMediaDto(app, completed)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  })
}
