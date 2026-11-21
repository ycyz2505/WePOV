import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { getPool, withTransaction, type Tx } from '@wepov/database'
import {
  hashPassword,
  isSealedValue,
  newInitialPassword,
  writeAudit,
  type Role,
} from '@wepov/security'
import { ApiError, validationError } from '../errors.js'
import {
  albumDecisionSchema,
  moderationSchema,
  roleUpdateSchema,
  rosterImportSchema,
  versionPolicySchema,
  visibilityUpdateSchema,
} from '../schemas.js'
import { clampLimit, decodeCursor, encodeCursor } from '../lib/cursor.js'
import { invalidateVersionPolicy, loadVersionPolicy } from '../lib/policy.js'

const idSchema = z.string().uuid()
const pageQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

function requestId(request: FastifyRequest): string | null {
  return (request as FastifyRequest & { requestId?: string }).requestId ?? null
}

function requireAdmin(app: FastifyInstance, request: FastifyRequest) {
  const auth = app.requireAuth(request)
  if (auth.role !== 'general_admin' && auth.role !== 'super_admin') {
    throw ApiError.forbidden('admin_required', '需要管理员权限')
  }
  return auth
}

function requireSuperAdmin(app: FastifyInstance, request: FastifyRequest) {
  const auth = app.requireAuth(request)
  if (auth.role !== 'super_admin') {
    throw ApiError.forbidden('super_admin_required', '需要总管理员权限')
  }
  return auth
}

function auditEntry(request: FastifyRequest, auth: ReturnType<typeof requireSuperAdmin>, action: string, targetType?: string, targetId?: string) {
  return {
    classId: auth.classId,
    actorId: auth.userId,
    actorRole: auth.role,
    action,
    targetType: targetType ?? null,
    targetId: targetId ?? null,
    sessionId: auth.sessionId,
    requestId: requestId(request),
    ipHmac: request.ipHmac,
  }
}

function nextCursor<T extends { id: string; created_at: Date }>(rows: T[], limit: number): string | null {
  if (rows.length <= limit) return null
  const last = rows[limit - 1]!
  return encodeCursor({ k: last.created_at.toISOString(), i: last.id })
}

function parseCursor(raw: string | undefined): { k: string; i: string } | null {
  const cursor = decodeCursor(raw)
  if (raw && !cursor) throw ApiError.badRequest('invalid_cursor', '分页游标无效')
  return cursor
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else {
        cell += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(cell.trim())
      cell = ''
    } else if (char === '\n') {
      row.push(cell.trim())
      if (row.some((value) => value.length > 0)) rows.push(row)
      row = []
      cell = ''
    } else if (char !== '\r') {
      cell += char
    }
  }
  if (quoted) throw ApiError.badRequest('invalid_csv', 'CSV 引号未闭合')
  row.push(cell.trim())
  if (row.some((value) => value.length > 0)) rows.push(row)
  return rows
}

const rosterRowSchema = z.object({
  studentNumber: z.string().max(30),
  realName: z.string().min(1).max(30),
  gender: z.string().min(1).max(20),
  nickname: z.string().min(1).max(12),
  initialPassword: z.string().min(8).max(64).optional(),
})

interface PreparedRosterRow {
  line: number
  studentNumber: string
  realName: string
  gender: string
  nickname: string
  initialPassword?: string
  password: string
  generated: boolean
  credential: Awaited<ReturnType<typeof hashPassword>>
}

async function prepareRoster(csv: string, matchKey: Buffer): Promise<{
  rows: PreparedRosterRow[]
  errors: Array<{ line: number; message: string }>
}> {
  const parsed = parseCsv(csv)
  if (parsed.length < 2) throw ApiError.badRequest('invalid_csv', 'CSV 需要表头和至少一行数据')
  const header = parsed[0]!.map((value) => value.trim())
  const aliases: Record<string, string> = {
    studentNumber: 'studentNumber',
    student_number: 'studentNumber',
    学号: 'studentNumber',
    realName: 'realName',
    real_name: 'realName',
    姓名: 'realName',
    gender: 'gender',
    性别: 'gender',
    nickname: 'nickname',
    昵称: 'nickname',
    initialPassword: 'initialPassword',
    initial_password: 'initialPassword',
    初始密码: 'initialPassword',
  }
  const columns = header.map((name) => aliases[name] ?? '')
  for (const required of ['studentNumber', 'realName', 'gender', 'nickname']) {
    if (!columns.includes(required)) throw ApiError.badRequest('invalid_csv', `CSV 缺少列：${required}`)
  }

  const rows: PreparedRosterRow[] = []
  const errors: Array<{ line: number; message: string }> = []
  const seenNumbers = new Set<string>()
  const seenNicknames = new Set<string>()
  for (let index = 1; index < parsed.length; index += 1) {
    const values = parsed[index]!
    const data: Record<string, string> = {}
    for (let column = 0; column < columns.length; column += 1) {
      const key = columns[column]
      if (key) data[key] = values[column]?.trim() ?? ''
    }
    const result = rosterRowSchema.safeParse({
      studentNumber: data['studentNumber'] ?? '',
      realName: data['realName'] ?? '',
      gender: data['gender'] ?? '',
      nickname: data['nickname'] ?? '',
      ...(data['initialPassword'] ? { initialPassword: data['initialPassword'] } : {}),
    })
    if (!result.success) {
      errors.push({ line: index + 1, message: result.error.issues[0]?.message ?? '数据不合法' })
      continue
    }
    const nicknameNorm = result.data.nickname.trim().toLocaleLowerCase('zh-CN')
    const studentNumber = result.data.studentNumber
    if ((studentNumber && seenNumbers.has(studentNumber)) || seenNicknames.has(nicknameNorm)) {
      errors.push({ line: index + 1, message: 'CSV 内存在重复学号或昵称' })
      continue
    }
    if (studentNumber) seenNumbers.add(studentNumber)
    seenNicknames.add(nicknameNorm)
    const generated = !result.data.initialPassword
    const password = result.data.initialPassword ?? newInitialPassword()
    const credential = await hashPassword(matchKey, password)
    rows.push({
      line: index + 1,
      studentNumber: result.data.studentNumber,
      realName: result.data.realName,
      gender: result.data.gender,
      nickname: result.data.nickname,
      ...(result.data.initialPassword ? { initialPassword: result.data.initialPassword } : {}),
      password,
      generated,
      credential,
    })
  }
  return { rows, errors }
}

async function restoreEntity(tx: Tx, classId: string, kind: string, entityId: string, payload: unknown): Promise<boolean> {
  switch (kind) {
    case 'tree_post':
      return (await tx.query(`UPDATE tree_posts SET status = 'visible', moderation_note = NULL WHERE id = $1 AND class_id = $2`, [entityId, classId])).rowCount === 1
    case 'tree_comment':
      return (await tx.query(`UPDATE tree_comments SET status = 'visible', moderation_note = NULL WHERE id = $1 AND class_id = $2`, [entityId, classId])).rowCount === 1
    case 'partner_post':
      return (await tx.query(`UPDATE partner_posts SET status = 'open' WHERE id = $1 AND class_id = $2 AND expires_at > now()`, [entityId, classId])).rowCount === 1
    case 'media':
      return (await tx.query(`UPDATE media_objects SET status = 'active', review_status = 'none', hidden_by_request = false WHERE id = $1 AND class_id = $2`, [entityId, classId])).rowCount === 1
    case 'album_folder': {
      if (typeof payload !== 'object' || payload === null) return false
      const value = payload as Record<string, unknown>
      if (typeof value['name'] !== 'string' || typeof value['path'] !== 'string') return false
      const result = await tx.query(
        `INSERT INTO album_folders (id, class_id, parent_id, name, depth, path, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [entityId, classId, value['parentId'] ?? null, value['name'], value['depth'] ?? 0, value['path'], value['createdBy']],
      )
      return result.rowCount === 1
    }
    default:
      return false
  }
}

async function purgeEntity(tx: Tx, classId: string, kind: string, entityId: string): Promise<void> {
  switch (kind) {
    case 'tree_post':
      await tx.query('DELETE FROM tree_posts WHERE id = $1 AND class_id = $2', [entityId, classId])
      break
    case 'tree_comment':
      await tx.query('DELETE FROM tree_comments WHERE id = $1 AND class_id = $2', [entityId, classId])
      break
    case 'partner_post':
      await tx.query('DELETE FROM partner_posts WHERE id = $1 AND class_id = $2', [entityId, classId])
      break
    case 'media':
      await tx.query('DELETE FROM media_objects WHERE id = $1 AND class_id = $2', [entityId, classId])
      break
    case 'album_folder':
      break
    default:
      throw ApiError.badRequest('unsupported_recycle_kind', '该类型不支持彻底删除')
  }
}

function decryptLogField(app: FastifyInstance, value: unknown, aad: string): string | null {
  if (!isSealedValue(value)) return null
  try {
    return app.config.security.encryption.openString(value, aad)
  } catch {
    return null
  }
}

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/admin/moderation/reports', async (request) => {
    const auth = requireAdmin(app, request)
    const parsed = pageQuerySchema.extend({ status: z.enum(['open', 'resolved', 'dismissed']).optional() }).safeParse(request.query)
    if (!parsed.success) throw validationError(parsed.error.issues)
    const limit = clampLimit(parsed.data.limit)
    const cursor = parseCursor(parsed.data.cursor)
    const result = await getPool().query<{
      id: string; target_type: string; target_id: string; reason: string; details: string; status: string
      reporter_nickname: string | null; created_at: Date; preview: string | null
    }>(
      `SELECT r.id, r.target_type, r.target_id, r.reason, r.details, r.status,
              p.nickname AS reporter_nickname, r.created_at,
              CASE r.target_type
                WHEN 'tree_post' THEN (SELECT left(tp.content, 180) FROM tree_posts tp WHERE tp.id = r.target_id AND tp.class_id = r.class_id)
                WHEN 'tree_comment' THEN (SELECT left(tc.content, 180) FROM tree_comments tc WHERE tc.id = r.target_id AND tc.class_id = r.class_id)
                WHEN 'partner_post' THEN (SELECT left(pp.title || ' ' || pp.description, 180) FROM partner_posts pp WHERE pp.id = r.target_id AND pp.class_id = r.class_id)
                WHEN 'profile' THEN (SELECT left(pr.nickname || ' ' || pr.introduction, 180) FROM profiles pr WHERE pr.user_id = r.target_id AND pr.class_id = r.class_id)
                WHEN 'media' THEN (SELECT left(m.original_filename, 180) FROM media_objects m WHERE m.id = r.target_id AND m.class_id = r.class_id)
              END AS preview
         FROM reports r
         LEFT JOIN profiles p ON p.user_id = r.reporter_id AND p.class_id = r.class_id
        WHERE r.class_id = $1
          AND ($2::text IS NULL OR r.status = $2 OR ($2 = 'open' AND r.status = 'reviewing'))
          AND ($3::timestamptz IS NULL OR (r.created_at, r.id) < ($3, $4::uuid))
        ORDER BY r.created_at DESC, r.id DESC LIMIT $5`,
      [auth.classId, parsed.data.status ?? null, cursor?.k ?? null, cursor?.i ?? null, limit + 1],
    )
    return {
      items: result.rows.slice(0, limit).map((row) => ({
        id: row.id,
        targetType: row.target_type,
        targetId: row.target_id,
        reason: row.reason,
        details: row.details,
        status: row.status === 'reviewing' ? 'open' : row.status,
        reporterNickname: row.reporter_nickname,
        createdAt: row.created_at.toISOString(),
        preview: row.preview ?? '内容已不存在',
      })),
      nextCursor: nextCursor(result.rows, limit),
    }
  })

  app.post('/api/v1/admin/moderation/actions', async (request, reply) => {
    const auth = requireAdmin(app, request)
    const parsed = moderationSchema.safeParse(request.body)
    if (!parsed.success) throw validationError(parsed.error.issues)
    const body = parsed.data
    await withTransaction(async (tx) => {
      let before: Record<string, unknown> | null = null
      let after: Record<string, unknown> | null = null
      if (body.action === 'mute' || body.action === 'unmute') {
        if (body.targetType !== 'profile' && body.targetType !== 'user') throw ApiError.badRequest('invalid_target', '禁言目标必须是用户')
        const row = await tx.queryOne<{ muted_until: Date | null }>(
          'SELECT muted_until FROM class_members WHERE class_id = $1 AND user_id = $2 FOR UPDATE',
          [auth.classId, body.targetId],
        )
        if (!row) throw ApiError.notFound('target_not_found', '目标用户不存在')
        before = { mutedUntil: row.muted_until?.toISOString() ?? null }
        const mutedUntil = body.action === 'mute' ? new Date(Date.now() + (body.durationMinutes ?? 60) * 60_000) : null
        await tx.query('UPDATE class_members SET muted_until = $3 WHERE class_id = $1 AND user_id = $2', [auth.classId, body.targetId, mutedUntil])
        after = { mutedUntil: mutedUntil?.toISOString() ?? null }
      } else if (body.targetType === 'tree_post' || body.targetType === 'tree_comment') {
        const table = body.targetType === 'tree_post' ? 'tree_posts' : 'tree_comments'
        const row = await tx.queryOne<{ status: string; moderation_note: string | null }>(
          `SELECT status, moderation_note FROM ${table} WHERE id = $1 AND class_id = $2 FOR UPDATE`,
          [body.targetId, auth.classId],
        )
        if (!row) throw ApiError.notFound('target_not_found', '目标内容不存在')
        before = { status: row.status, moderationNote: row.moderation_note }
        const nextStatus = body.action === 'restore' ? 'visible' : body.action
        await tx.query(
          `UPDATE ${table} SET status = $3, moderation_note = $4 WHERE id = $1 AND class_id = $2`,
          [body.targetId, auth.classId, nextStatus, body.action === 'restore' ? null : body.reason],
        )
        after = { status: nextStatus, moderationNote: body.action === 'restore' ? null : body.reason }
        if (body.action === 'remove') {
          const label = table === 'tree_posts' ? '树洞帖子' : '树洞评论'
          await tx.query(
            `INSERT INTO recycle_bin_entries (class_id, entity_type, entity_id, label, payload, deleted_by)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [auth.classId, body.targetType, body.targetId, label, JSON.stringify(before), auth.userId],
          )
        }
      } else if (body.targetType === 'partner_post') {
        const row = await tx.queryOne<{ status: string; title: string; expires_at: Date }>(
          `SELECT status, title, expires_at FROM partner_posts WHERE id = $1 AND class_id = $2 FOR UPDATE`,
          [body.targetId, auth.classId],
        )
        if (!row) throw ApiError.notFound('target_not_found', '目标内容不存在')
        before = { status: row.status }
        const nextStatus = body.action === 'restore' ? (row.expires_at > new Date() ? 'open' : 'expired') : 'cancelled'
        await tx.query('UPDATE partner_posts SET status = $3 WHERE id = $1 AND class_id = $2', [body.targetId, auth.classId, nextStatus])
        after = { status: nextStatus }
        if (body.action === 'remove') {
          await tx.query(
            `INSERT INTO recycle_bin_entries (class_id, entity_type, entity_id, label, payload, deleted_by)
             VALUES ($1,'partner_post',$2,$3,$4,$5)`,
            [auth.classId, body.targetId, row.title, JSON.stringify(before), auth.userId],
          )
        }
      } else if (body.targetType === 'media') {
        const row = await tx.queryOne<{ status: string; original_filename: string; object_key: string }>(
          `SELECT status, original_filename, object_key FROM media_objects WHERE id = $1 AND class_id = $2 FOR UPDATE`,
          [body.targetId, auth.classId],
        )
        if (!row) throw ApiError.notFound('target_not_found', '目标内容不存在')
        before = { status: row.status }
        const nextStatus = body.action === 'restore' ? 'active' : body.action === 'remove' ? 'deleted' : 'hidden'
        await tx.query('UPDATE media_objects SET status = $3 WHERE id = $1 AND class_id = $2', [body.targetId, auth.classId, nextStatus])
        after = { status: nextStatus }
        if (body.action === 'remove') {
          await tx.query(
            `INSERT INTO recycle_bin_entries (class_id, entity_type, entity_id, label, payload, deleted_by)
             VALUES ($1,'media',$2,$3,$4,$5)`,
            [auth.classId, body.targetId, row.original_filename, JSON.stringify({ status: row.status, objectKey: row.object_key }), auth.userId],
          )
        }
      } else if (body.targetType === 'profile') {
        const row = await tx.queryOne<{ hidden: boolean }>(
          `SELECT hidden FROM class_members WHERE user_id = $1 AND class_id = $2 FOR UPDATE`,
          [body.targetId, auth.classId],
        )
        if (!row) throw ApiError.notFound('target_not_found', '目标用户不存在')
        before = { hidden: row.hidden }
        const hidden = body.action !== 'restore'
        await tx.query('UPDATE class_members SET hidden = $3 WHERE user_id = $1 AND class_id = $2', [body.targetId, auth.classId, hidden])
        after = { hidden }
      } else {
        throw ApiError.badRequest('invalid_target', '该内容类型不支持此管理操作')
      }
      const auditId = await writeAudit(tx, {
        ...auditEntry(request, auth, `moderation.${body.action}`, body.targetType, body.targetId),
        beforeState: before,
        afterState: after,
      })
      await tx.query(
        `INSERT INTO moderation_actions
           (class_id, operator_id, target_type, target_id, action, reason,
            show_reason_to_subject, show_operator, duration_minutes, audit_event_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [auth.classId, auth.userId, body.targetType, body.targetId, body.action, body.reason, body.showReasonToSubject, body.showOperator, body.durationMinutes ?? null, auditId],
      )
      await tx.query(
        `UPDATE reports SET status = 'resolved', handled_by = $3, handled_at = now(), resolution_note = $4
          WHERE class_id = $1 AND target_type = $2 AND target_id = $5 AND status IN ('open','reviewing')`,
        [auth.classId, body.targetType, auth.userId, body.reason, body.targetId],
      )
    })
    reply.status(204).send()
  })

  app.get('/api/v1/admin/moderation/album', async (request) => {
    const auth = requireAdmin(app, request)
    const parsed = pageQuerySchema.safeParse(request.query)
    if (!parsed.success) throw validationError(parsed.error.issues)
    const limit = clampLimit(parsed.data.limit)
    const cursor = parseCursor(parsed.data.cursor)
    const result = await getPool().query<{
      id: string; type: 'media_delete' | 'folder_move' | 'folder_delete'; subject_nickname: string
      reason: string; target_name: string; created_at: Date; media_id: string | null; folder_id: string | null
    }>(
      `SELECT * FROM (
         SELECT r.id, 'media_delete'::text AS type, p.nickname AS subject_nickname,
                r.reason, m.original_filename AS target_name, r.created_at,
                r.media_id, NULL::uuid AS folder_id
           FROM media_delete_requests r
           JOIN media_objects m ON m.id = r.media_id AND m.class_id = r.class_id
           JOIN profiles p ON p.user_id = r.requester_id AND p.class_id = r.class_id
          WHERE r.class_id = $1 AND r.status = 'pending'
         UNION ALL
         SELECT r.id, ('folder_' || r.operation)::text AS type, p.nickname AS subject_nickname,
                r.reason, f.name AS target_name, r.created_at,
                NULL::uuid AS media_id, r.folder_id
           FROM folder_change_requests r
           JOIN album_folders f ON f.id = r.folder_id AND f.class_id = r.class_id
           JOIN profiles p ON p.user_id = r.requester_id AND p.class_id = r.class_id
          WHERE r.class_id = $1 AND r.status = 'pending'
       ) queue
       WHERE ($2::timestamptz IS NULL OR (created_at, id) < ($2, $3::uuid))
       ORDER BY created_at DESC, id DESC LIMIT $4`,
      [auth.classId, cursor?.k ?? null, cursor?.i ?? null, limit + 1],
    )
    return {
      items: result.rows.slice(0, limit).map((row) => ({
        id: row.id,
        type: row.type,
        subjectNickname: row.subject_nickname,
        reason: row.reason,
        targetName: row.target_name,
        createdAt: row.created_at.toISOString(),
        mediaId: row.media_id,
        folderId: row.folder_id,
      })),
      nextCursor: nextCursor(result.rows, limit),
    }
  })

  app.post('/api/v1/admin/moderation/album/:id', async (request, reply) => {
    const auth = requireAdmin(app, request)
    const id = idSchema.safeParse((request.params as { id?: unknown }).id)
    const parsed = albumDecisionSchema.safeParse(request.body)
    if (!id.success) throw validationError(id.error.issues)
    if (!parsed.success) throw validationError(parsed.error.issues)
    await withTransaction(async (tx) => {
      const mediaRequest = await tx.queryOne<{
        media_id: string; requester_id: string; reason: string; object_key: string; original_filename: string; status: string
      }>(
        `SELECT r.media_id, r.requester_id, r.reason, m.object_key, m.original_filename, m.status
           FROM media_delete_requests r JOIN media_objects m ON m.id = r.media_id
          WHERE r.id = $1 AND r.class_id = $2 AND r.status = 'pending' FOR UPDATE OF r, m`,
        [id.data, auth.classId],
      )
      if (mediaRequest) {
        const approved = parsed.data.decision === 'approve'
        await tx.query(
          `UPDATE media_delete_requests SET status = $3, handled_by = $4, handled_at = now()
            WHERE id = $1 AND class_id = $2`,
          [id.data, auth.classId, approved ? 'approved' : 'rejected', auth.userId],
        )
        if (approved) {
          await tx.query(
            `UPDATE media_objects SET status = 'deleted', review_status = 'approved', hidden_by_request = true
              WHERE id = $1 AND class_id = $2`,
            [mediaRequest.media_id, auth.classId],
          )
          await tx.query(
            `INSERT INTO recycle_bin_entries (class_id, entity_type, entity_id, label, payload, deleted_by)
             VALUES ($1,'media',$2,$3,$4,$5)`,
            [auth.classId, mediaRequest.media_id, mediaRequest.original_filename, JSON.stringify({ objectKey: mediaRequest.object_key, status: mediaRequest.status }), auth.userId],
          )
        }
        await writeAudit(tx, {
          ...auditEntry(request, auth, `album.media_delete.${parsed.data.decision}`, 'media', mediaRequest.media_id),
          beforeState: { status: mediaRequest.status },
          afterState: { request: approved ? 'approved' : 'rejected', status: approved ? 'deleted' : mediaRequest.status },
        })
        return
      }

      const folderRequest = await tx.queryOne<{
        folder_id: string; operation: 'move' | 'delete'; target_parent_id: string | null; reason: string
        parent_id: string | null; name: string; depth: number; path: string; created_by: string
      }>(
        `SELECT r.folder_id, r.operation, r.target_parent_id, r.reason,
                f.parent_id, f.name, f.depth, f.path, f.created_by
           FROM folder_change_requests r JOIN album_folders f ON f.id = r.folder_id
          WHERE r.id = $1 AND r.class_id = $2 AND r.status = 'pending' FOR UPDATE OF r, f`,
        [id.data, auth.classId],
      )
      if (!folderRequest) throw ApiError.notFound('review_not_found', '审核项不存在')
      const approved = parsed.data.decision === 'approve'
      if (approved && folderRequest.operation === 'move') {
        const parent = folderRequest.target_parent_id
          ? await tx.queryOne<{ path: string; depth: number }>('SELECT path, depth FROM album_folders WHERE id = $1 AND class_id = $2', [folderRequest.target_parent_id, auth.classId])
          : null
        if (folderRequest.target_parent_id && !parent) throw ApiError.notFound('folder_not_found', '目标文件夹不存在')
        const path = parent ? `${parent.path}/${folderRequest.name}` : `/${folderRequest.name}`
        await tx.query('UPDATE album_folders SET parent_id = $3, path = $4 WHERE id = $1 AND class_id = $2', [folderRequest.folder_id, auth.classId, folderRequest.target_parent_id, path])
      } else if (approved) {
        const counts = await tx.queryOne<{ children: string; media: string }>(
          `SELECT (SELECT count(*) FROM album_folders WHERE parent_id = $1)::text AS children,
                  (SELECT count(*) FROM media_objects WHERE folder_id = $1 AND status <> 'deleted')::text AS media`,
          [folderRequest.folder_id],
        )
        if (Number(counts?.children ?? 0) > 0 || Number(counts?.media ?? 0) > 0) {
          throw ApiError.conflict('folder_not_empty', '只能删除空文件夹')
        }
        await tx.query(
          `INSERT INTO recycle_bin_entries (class_id, entity_type, entity_id, label, payload, deleted_by)
           VALUES ($1,'album_folder',$2,$3,$4,$5)`,
          [auth.classId, folderRequest.folder_id, folderRequest.name, JSON.stringify({ parentId: folderRequest.parent_id, name: folderRequest.name, depth: folderRequest.depth, path: folderRequest.path, createdBy: folderRequest.created_by }), auth.userId],
        )
        await tx.query('DELETE FROM album_folders WHERE id = $1 AND class_id = $2', [folderRequest.folder_id, auth.classId])
      }
      await tx.query(
        `UPDATE folder_change_requests SET status = $3, handled_by = $4, handled_at = now()
          WHERE id = $1 AND class_id = $2`,
        [id.data, auth.classId, approved ? 'approved' : 'rejected', auth.userId],
      )
      await writeAudit(tx, {
        ...auditEntry(request, auth, `album.folder_${folderRequest.operation}.${parsed.data.decision}`, 'album_folder', folderRequest.folder_id),
        beforeState: { parentId: folderRequest.parent_id, path: folderRequest.path },
        afterState: { decision: parsed.data.decision, targetParentId: folderRequest.target_parent_id },
      })
    })
    reply.status(204).send()
  })

  app.get('/api/v1/admin/roster', async (request) => {
    const auth = requireSuperAdmin(app, request)
    const parsed = pageQuerySchema.safeParse(request.query)
    if (!parsed.success) throw validationError(parsed.error.issues)
    const limit = clampLimit(parsed.data.limit)
    const cursor = parseCursor(parsed.data.cursor)
    const result = await getPool().query<{
      id: string; student_number: string | null; real_name: string; nickname: string; gender: string
      role: Role; hidden: boolean; must_change: boolean | null; created_at: Date
    }>(
      `SELECT u.id, cm.student_number, cm.real_name, p.nickname, cm.gender,
              COALESCE(ra.role, 'student') AS role, cm.hidden, pc.must_change, u.created_at
         FROM users u JOIN class_members cm ON cm.user_id = u.id
         JOIN profiles p ON p.user_id = u.id
         LEFT JOIN password_credentials pc ON pc.user_id = u.id
         LEFT JOIN role_assignments ra ON ra.user_id = u.id AND ra.class_id = cm.class_id AND ra.revoked_at IS NULL
        WHERE cm.class_id = $1 AND u.deleted_at IS NULL
          AND ($2::timestamptz IS NULL OR (u.created_at, u.id) < ($2, $3::uuid))
        ORDER BY u.created_at DESC, u.id DESC LIMIT $4`,
      [auth.classId, cursor?.k ?? null, cursor?.i ?? null, limit + 1],
    )
    return {
      items: result.rows.slice(0, limit).map((row) => ({
        id: row.id,
        studentNumber: row.student_number ?? '',
        realName: row.real_name,
        nickname: row.nickname,
        gender: row.gender,
        role: row.role,
        hidden: row.hidden,
        mustChangePassword: row.must_change ?? false,
        createdAt: row.created_at.toISOString(),
      })),
      nextCursor: nextCursor(result.rows, limit),
    }
  })

  app.post('/api/v1/admin/roster/import', async (request) => {
    const auth = requireSuperAdmin(app, request)
    const parsed = rosterImportSchema.safeParse(request.body)
    if (!parsed.success) throw validationError(parsed.error.issues)
    const prepared = await prepareRoster(parsed.data.csv, app.config.security.passwordMatchKey)
    if (prepared.rows.length === 0) {
      return { created: 0, updated: 0, skipped: prepared.errors.length, errors: prepared.errors, generatedPasswords: [] }
    }
    let created = 0
    let updated = 0
    const generatedPasswords: Array<{ studentNumber: string; realName: string; initialPassword: string }> = []
    await withTransaction(async (tx) => {
      for (const row of prepared.rows) {
        const existing = await tx.queryOne<{ user_id: string }>(
          `SELECT user_id FROM class_members WHERE class_id = $1 AND student_number = $2 FOR UPDATE`,
          [auth.classId, row.studentNumber],
        )
        if (existing) {
          await tx.query(
            `UPDATE class_members SET real_name = $3, gender = $4 WHERE class_id = $1 AND user_id = $2`,
            [auth.classId, existing.user_id, row.realName, row.gender],
          )
          await tx.query(
            `UPDATE profiles SET nickname = $3, nickname_norm = $4 WHERE class_id = $1 AND user_id = $2`,
            [auth.classId, existing.user_id, row.nickname, row.nickname.toLocaleLowerCase('zh-CN')],
          )
          if (row.initialPassword) {
            await tx.query(
              `INSERT INTO password_credentials (user_id, password_hash, password_length, match_tag, must_change)
               VALUES ($1,$2,$3,$4,true)
               ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash,
                 password_length = EXCLUDED.password_length, match_tag = EXCLUDED.match_tag,
                 must_change = true, updated_at = now()`,
              [existing.user_id, row.credential.hash, row.credential.length, row.credential.matchTag],
            )
          }
          updated += 1
        } else {
          const user = await tx.queryOne<{ id: string }>('INSERT INTO users DEFAULT VALUES RETURNING id')
          if (!user) throw new Error('User insert returned no id')
          await tx.query(
            `INSERT INTO class_members (class_id, user_id, student_number, real_name, gender)
             VALUES ($1,$2,$3,$4,$5)`,
            [auth.classId, user.id, row.studentNumber || null, row.realName, row.gender],
          )
          await tx.query(
            `INSERT INTO profiles (class_id, user_id, nickname, nickname_norm)
             VALUES ($1,$2,$3,$4)`,
            [auth.classId, user.id, row.nickname, row.nickname.toLocaleLowerCase('zh-CN')],
          )
          await tx.query(
            `INSERT INTO password_credentials (user_id, password_hash, password_length, match_tag, must_change)
             VALUES ($1,$2,$3,$4,true)`,
            [user.id, row.credential.hash, row.credential.length, row.credential.matchTag],
          )
          created += 1
          if (row.generated) {
            generatedPasswords.push({
              studentNumber: row.studentNumber,
              realName: row.realName,
              initialPassword: row.password,
            })
          }
        }
      }
      await writeAudit(tx, {
        ...auditEntry(request, auth, 'roster.import', 'class', auth.classId),
        afterState: { created, updated, skipped: prepared.errors.length },
      })
    })
    return {
      created,
      updated,
      skipped: prepared.errors.length,
      errors: prepared.errors,
      generatedPasswords,
    }
  })

  app.put('/api/v1/admin/roster/:userId/role', async (request, reply) => {
    const auth = requireSuperAdmin(app, request)
    const userId = idSchema.safeParse((request.params as { userId?: unknown }).userId)
    const parsed = roleUpdateSchema.safeParse(request.body)
    if (!userId.success) throw validationError(userId.error.issues)
    if (!parsed.success) throw validationError(parsed.error.issues)
    await withTransaction(async (tx) => {
      const target = await tx.queryOne<{ role: Role }>(
        `SELECT COALESCE(ra.role, 'student') AS role
           FROM class_members cm LEFT JOIN role_assignments ra
             ON ra.user_id = cm.user_id AND ra.class_id = cm.class_id AND ra.revoked_at IS NULL
          WHERE cm.class_id = $1 AND cm.user_id = $2 FOR UPDATE OF cm`,
        [auth.classId, userId.data],
      )
      if (!target) throw ApiError.notFound('user_not_found', '用户不存在')
      if (target.role === 'super_admin' && parsed.data.role !== 'super_admin') {
        throw ApiError.conflict('only_super_admin', '不能降级班级唯一的总管理员')
      }
      if (parsed.data.role === 'super_admin') {
        const current = await tx.queryOne<{ user_id: string }>(
          `SELECT user_id FROM role_assignments WHERE class_id = $1 AND role = 'super_admin' AND revoked_at IS NULL FOR UPDATE`,
          [auth.classId],
        )
        if (current && current.user_id !== userId.data) {
          await tx.query(`UPDATE role_assignments SET revoked_at = now(), revoked_by = $2 WHERE class_id = $1 AND user_id = $3 AND revoked_at IS NULL`, [auth.classId, auth.userId, current.user_id])
          await tx.query(`INSERT INTO role_assignments (class_id, user_id, role, granted_by) VALUES ($1,$2,'student',$3)`, [auth.classId, current.user_id, auth.userId])
        }
      }
      await tx.query(`UPDATE role_assignments SET revoked_at = now(), revoked_by = $3 WHERE class_id = $1 AND user_id = $2 AND revoked_at IS NULL`, [auth.classId, userId.data, auth.userId])
      await tx.query(`INSERT INTO role_assignments (class_id, user_id, role, granted_by) VALUES ($1,$2,$3,$4)`, [auth.classId, userId.data, parsed.data.role, auth.userId])
      await writeAudit(tx, {
        ...auditEntry(request, auth, 'roster.role_update', 'user', userId.data),
        beforeState: { role: target.role },
        afterState: { role: parsed.data.role },
      })
    })
    reply.status(204).send()
  })

  app.put('/api/v1/admin/roster/:userId/visibility', async (request, reply) => {
    const auth = requireSuperAdmin(app, request)
    const userId = idSchema.safeParse((request.params as { userId?: unknown }).userId)
    const parsed = visibilityUpdateSchema.safeParse(request.body)
    if (!userId.success) throw validationError(userId.error.issues)
    if (!parsed.success) throw validationError(parsed.error.issues)
    await withTransaction(async (tx) => {
      const row = await tx.queryOne<{ hidden: boolean }>('SELECT hidden FROM class_members WHERE class_id = $1 AND user_id = $2 FOR UPDATE', [auth.classId, userId.data])
      if (!row) throw ApiError.notFound('user_not_found', '用户不存在')
      await tx.query('UPDATE class_members SET hidden = $3 WHERE class_id = $1 AND user_id = $2', [auth.classId, userId.data, parsed.data.hidden])
      await writeAudit(tx, {
        ...auditEntry(request, auth, 'roster.visibility_update', 'user', userId.data),
        beforeState: { hidden: row.hidden },
        afterState: { hidden: parsed.data.hidden },
      })
    })
    reply.status(204).send()
  })

  app.post('/api/v1/admin/roster/:userId/reset-password', async (request) => {
    const auth = requireSuperAdmin(app, request)
    const userId = idSchema.safeParse((request.params as { userId?: unknown }).userId)
    if (!userId.success) throw validationError(userId.error.issues)
    const initialPassword = newInitialPassword()
    const credential = await hashPassword(app.config.security.passwordMatchKey, initialPassword)
    await withTransaction(async (tx) => {
      const member = await tx.queryOne<{ user_id: string }>('SELECT user_id FROM class_members WHERE class_id = $1 AND user_id = $2 FOR UPDATE', [auth.classId, userId.data])
      if (!member) throw ApiError.notFound('user_not_found', '用户不存在')
      await tx.query(
        `INSERT INTO password_credentials (user_id, password_hash, password_length, match_tag, must_change)
         VALUES ($1,$2,$3,$4,true)
         ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash,
           password_length = EXCLUDED.password_length, match_tag = EXCLUDED.match_tag,
           must_change = true, updated_at = now()`,
        [userId.data, credential.hash, credential.length, credential.matchTag],
      )
      await tx.query(`UPDATE sessions SET revoked_at = now(), revoked_reason = 'password_reset' WHERE class_id = $1 AND user_id = $2 AND revoked_at IS NULL`, [auth.classId, userId.data])
      await tx.query(`UPDATE session_families SET revoked_at = now(), revoked_reason = 'password_reset' WHERE class_id = $1 AND user_id = $2 AND revoked_at IS NULL`, [auth.classId, userId.data])
      await writeAudit(tx, auditEntry(request, auth, 'roster.password_reset', 'user', userId.data))
    })
    return { initialPassword }
  })

  app.get('/api/v1/admin/recycle', async (request) => {
    const auth = requireSuperAdmin(app, request)
    const parsed = pageQuerySchema.safeParse(request.query)
    if (!parsed.success) throw validationError(parsed.error.issues)
    const limit = clampLimit(parsed.data.limit)
    const cursor = parseCursor(parsed.data.cursor)
    const result = await getPool().query<{
      id: string; entity_type: string; label: string; deleted_by_nickname: string | null; created_at: Date; entity_id: string
    }>(
      `SELECT r.id, r.entity_type, r.label, p.nickname AS deleted_by_nickname, r.created_at, r.entity_id
         FROM recycle_bin_entries r LEFT JOIN profiles p ON p.user_id = r.deleted_by AND p.class_id = r.class_id
        WHERE r.class_id = $1 AND r.restored_at IS NULL AND r.purged_at IS NULL
          AND ($2::timestamptz IS NULL OR (r.created_at, r.id) < ($2, $3::uuid))
        ORDER BY r.created_at DESC, r.id DESC LIMIT $4`,
      [auth.classId, cursor?.k ?? null, cursor?.i ?? null, limit + 1],
    )
    return {
      items: result.rows.slice(0, limit).map((row) => ({
        id: row.id,
        kind: row.entity_type,
        label: row.label,
        deletedByNickname: row.deleted_by_nickname ?? '系统',
        deletedAt: row.created_at.toISOString(),
        restorable: true,
      })),
      nextCursor: nextCursor(result.rows, limit),
    }
  })

  app.post('/api/v1/admin/recycle/:id/restore', async (request, reply) => {
    const auth = requireSuperAdmin(app, request)
    const id = idSchema.safeParse((request.params as { id?: unknown }).id)
    if (!id.success) throw validationError(id.error.issues)
    await withTransaction(async (tx) => {
      const entry = await tx.queryOne<{ entity_type: string; entity_id: string; payload: unknown }>(
        `SELECT entity_type, entity_id, payload FROM recycle_bin_entries
          WHERE id = $1 AND class_id = $2 AND restored_at IS NULL AND purged_at IS NULL FOR UPDATE`,
        [id.data, auth.classId],
      )
      if (!entry) throw ApiError.notFound('recycle_not_found', '回收站条目不存在')
      const restored = await restoreEntity(tx, auth.classId, entry.entity_type, entry.entity_id, entry.payload)
      if (!restored) throw ApiError.conflict('restore_failed', '原始资源已不存在或无法恢复')
      await tx.query('UPDATE recycle_bin_entries SET restored_at = now(), restored_by = $3 WHERE id = $1 AND class_id = $2', [id.data, auth.classId, auth.userId])
      await writeAudit(tx, auditEntry(request, auth, 'recycle.restore', entry.entity_type, entry.entity_id))
    })
    reply.status(204).send()
  })

  app.delete('/api/v1/admin/recycle/:id', async (request, reply) => {
    const auth = requireSuperAdmin(app, request)
    const id = idSchema.safeParse((request.params as { id?: unknown }).id)
    if (!id.success) throw validationError(id.error.issues)
    const existing = await getPool().query<{ entity_type: string; entity_id: string; payload: unknown }>(
      `SELECT entity_type, entity_id, payload FROM recycle_bin_entries
        WHERE id = $1 AND class_id = $2 AND restored_at IS NULL AND purged_at IS NULL`,
      [id.data, auth.classId],
    )
    const entry = existing.rows[0]
    if (!entry) throw ApiError.notFound('recycle_not_found', '回收站条目不存在')
    if (entry.entity_type === 'media' && typeof entry.payload === 'object' && entry.payload !== null) {
      const objectKey = (entry.payload as Record<string, unknown>)['objectKey']
      if (typeof objectKey === 'string' && app.u3.configured) await app.u3.deleteObject(app.u3.buckets.media, objectKey)
    }
    await withTransaction(async (tx) => {
      const locked = await tx.queryOne<{ entity_type: string; entity_id: string }>(
        `SELECT entity_type, entity_id FROM recycle_bin_entries
          WHERE id = $1 AND class_id = $2 AND restored_at IS NULL AND purged_at IS NULL FOR UPDATE`,
        [id.data, auth.classId],
      )
      if (!locked) throw ApiError.notFound('recycle_not_found', '回收站条目不存在')
      await purgeEntity(tx, auth.classId, locked.entity_type, locked.entity_id)
      await tx.query('UPDATE recycle_bin_entries SET purged_at = now() WHERE id = $1 AND class_id = $2', [id.data, auth.classId])
      await writeAudit(tx, auditEntry(request, auth, 'recycle.purge', locked.entity_type, locked.entity_id))
    })
    reply.status(204).send()
  })

  app.get('/api/v1/admin/logs/traffic', async (request) => {
    const auth = requireSuperAdmin(app, request)
    const parsed = z.object({ range: z.enum(['today', '7d', '30d']).default('today') }).safeParse(request.query)
    if (!parsed.success) throw validationError(parsed.error.issues)
    const interval = parsed.data.range === 'today' ? '1 day' : parsed.data.range === '7d' ? '7 days' : '30 days'
    const result = await getPool().query<{
      pv: string; uv: string; active_users: string; peak_qps: string; p50_ms: number | null; p95_ms: number | null
      error_rate: number | null; throttled: string; login_failures: string
    }>(
      `WITH logs AS (
         SELECT * FROM request_log_index WHERE class_id = $1 AND created_at >= now() - $2::interval
       ), per_second AS (
         SELECT date_trunc('second', created_at) AS second, count(*) AS qps FROM logs GROUP BY 1
       )
       SELECT count(*)::text AS pv, count(DISTINCT user_hmac)::text AS uv,
              count(DISTINCT user_hmac) FILTER (WHERE user_hmac IS NOT NULL)::text AS active_users,
              COALESCE((SELECT max(qps) FROM per_second), 0)::text AS peak_qps,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)::float8 AS p50_ms,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::float8 AS p95_ms,
              COALESCE(avg((status_code >= 500)::int), 0)::float8 AS error_rate,
              count(*) FILTER (WHERE status_code = 429)::text AS throttled,
              (SELECT count(*)::text FROM login_failures WHERE class_id = $1 AND last_failed_at >= now() - $2::interval) AS login_failures
         FROM logs`,
      [auth.classId, interval],
    )
    const modules = await getPool().query<{ module: string; count: string }>(
      `SELECT split_part(trim(leading '/' FROM route), '/', 3) AS module, count(*)::text AS count
         FROM request_log_index WHERE class_id = $1 AND created_at >= now() - $2::interval
        GROUP BY 1 ORDER BY count(*) DESC LIMIT 20`,
      [auth.classId, interval],
    )
    const storage = await getPool().query<{ growth: string }>(
      `SELECT COALESCE(max(storage_bytes) - min(storage_bytes), 0)::text AS growth
         FROM daily_metrics WHERE class_id = $1 AND metric_day >= (current_date - $2::interval)::date`,
      [auth.classId, interval],
    )
    const counts = await getPool().query<{ moderation: string; reveals: string }>(
      `SELECT
         (SELECT count(*) FROM moderation_actions WHERE class_id = $1 AND created_at >= now() - $2::interval)::text AS moderation,
         (SELECT count(*) FROM audit_events WHERE class_id = $1 AND action = 'tree.identity_reveal' AND created_at >= now() - $2::interval)::text AS reveals`,
      [auth.classId, interval],
    )
    const row = result.rows[0]!
    return {
      range: parsed.data.range,
      pv: Number(row.pv),
      uv: Number(row.uv),
      activeUsers: Number(row.active_users),
      peakQps: Number(row.peak_qps),
      p50Ms: Math.round(row.p50_ms ?? 0),
      p95Ms: Math.round(row.p95_ms ?? 0),
      errorRate: row.error_rate ?? 0,
      loginFailures: Number(row.login_failures),
      throttled: Number(row.throttled),
      moduleUsage: modules.rows.map((item) => ({ module: item.module || 'other', count: Number(item.count) })),
      storageGrowthBytes: Number(storage.rows[0]?.growth ?? 0),
      moderationActions: Number(counts.rows[0]?.moderation ?? 0),
      identityReveals: Number(counts.rows[0]?.reveals ?? 0),
    }
  })

  app.get('/api/v1/admin/logs/http', async (request) => {
    const auth = requireSuperAdmin(app, request)
    const parsed = pageQuerySchema.extend({
      route: z.string().max(200).optional(),
      status: z.coerce.number().int().min(100).max(599).optional(),
      requestId: z.string().max(80).optional(),
    }).safeParse(request.query)
    if (!parsed.success) throw validationError(parsed.error.issues)
    const limit = clampLimit(parsed.data.limit)
    const cursor = parseCursor(parsed.data.cursor)
    const result = await getPool().query<{
      id: string; request_id: string; created_at: Date; route: string; method: string; status_code: number
      duration_ms: number; response_bytes: number; user_hmac: string | null; device_hmac: string | null
      ip_enc: unknown; user_agent_enc: unknown; error_class: string | null
    }>(
      `SELECT id, request_id, created_at, route, method, status_code, duration_ms, response_bytes,
              user_hmac, device_hmac, ip_enc, user_agent_enc, error_class
         FROM request_log_index
        WHERE class_id = $1
          AND ($2::text IS NULL OR route = $2)
          AND ($3::int IS NULL OR status_code = $3)
          AND ($4::text IS NULL OR request_id = $4)
          AND ($5::timestamptz IS NULL OR (created_at, id) < ($5, $6::uuid))
        ORDER BY created_at DESC, id DESC LIMIT $7`,
      [auth.classId, parsed.data.route ?? null, parsed.data.status ?? null, parsed.data.requestId ?? null, cursor?.k ?? null, cursor?.i ?? null, limit + 1],
    )
    return {
      items: result.rows.slice(0, limit).map((row) => ({
        id: row.id,
        requestId: row.request_id,
        at: row.created_at.toISOString(),
        route: row.route,
        method: row.method,
        status: row.status_code,
        durationMs: row.duration_ms,
        responseBytes: row.response_bytes,
        accountSummary: row.user_hmac ? `账号 ${row.user_hmac.slice(0, 10)}` : null,
        deviceSummary: row.device_hmac ? `设备 ${row.device_hmac.slice(0, 10)}` : null,
        ip: decryptLogField(app, row.ip_enc, 'log:ip'),
        userAgent: decryptLogField(app, row.user_agent_enc, 'log:ua'),
        category: row.error_class,
      })),
      nextCursor: nextCursor(result.rows, limit),
    }
  })

  app.get('/api/v1/admin/logs/semantic', async (request) => {
    const auth = requireSuperAdmin(app, request)
    const parsed = pageQuerySchema.extend({ kind: z.string().max(60).optional() }).safeParse(request.query)
    if (!parsed.success) throw validationError(parsed.error.issues)
    const limit = clampLimit(parsed.data.limit)
    const cursor = parseCursor(parsed.data.cursor)
    const result = await getPool().query<{
      id: string; created_at: Date; event_type: string; nickname: string | null; target_type: string | null
      target_id: string | null; metadata: unknown
    }>(
      `SELECT e.id, e.created_at, e.event_type, p.nickname, e.target_type, e.target_id, e.metadata
         FROM semantic_events e LEFT JOIN profiles p ON p.user_id = e.user_id AND p.class_id = e.class_id
        WHERE e.class_id = $1 AND ($2::text IS NULL OR e.event_type = $2)
          AND ($3::timestamptz IS NULL OR (e.created_at, e.id) < ($3, $4::uuid))
        ORDER BY e.created_at DESC, e.id DESC LIMIT $5`,
      [auth.classId, parsed.data.kind ?? null, cursor?.k ?? null, cursor?.i ?? null, limit + 1],
    )
    return {
      items: result.rows.slice(0, limit).map((row) => ({
        id: row.id,
        at: row.created_at.toISOString(),
        kind: row.event_type,
        actorSummary: row.nickname ?? '系统',
        targetSummary: row.target_type ? `${row.target_type}${row.target_id ? ` ${row.target_id.slice(0, 8)}` : ''}` : '',
        detail: JSON.stringify(row.metadata),
      })),
      nextCursor: nextCursor(result.rows, limit),
    }
  })

  app.get('/api/v1/admin/security', async (request) => {
    const auth = requireSuperAdmin(app, request)
    const state = await getPool().query<{
      class_updated_at: Date; active_sessions: string; abnormal_sessions: string
    }>(
      `SELECT c.updated_at AS class_updated_at,
              (SELECT count(*) FROM sessions s JOIN session_families f ON f.id = s.family_id
                WHERE s.class_id = c.id AND s.revoked_at IS NULL AND f.revoked_at IS NULL
                  AND s.idle_expires_at > now() AND f.absolute_expires_at > now())::text AS active_sessions,
              (SELECT count(*) FROM security_alerts a
                WHERE a.class_id = c.id AND a.acknowledged_at IS NULL)::text AS abnormal_sessions
         FROM classes c WHERE c.id = $1`,
      [auth.classId],
    )
    const alerts = await getPool().query<{ id: string; severity: 'info' | 'warning' | 'critical'; kind: string; detail: unknown; created_at: Date }>(
      `SELECT id, severity, kind, detail, created_at FROM security_alerts
        WHERE class_id = $1 AND acknowledged_at IS NULL ORDER BY created_at DESC LIMIT 50`,
      [auth.classId],
    )
    const row = state.rows[0]
    if (!row) throw ApiError.notFound('class_not_found', '班级不存在')
    return {
      classPasscodeRotatedAt: row.class_updated_at.toISOString(),
      activeSessionCount: Number(row.active_sessions),
      abnormalSessionCount: Number(row.abnormal_sessions),
      alerts: alerts.rows.map((alert) => ({
        id: alert.id,
        level: alert.severity === 'warning' ? 'warn' : alert.severity,
        message: `${alert.kind}${Object.keys((alert.detail as Record<string, unknown> | null) ?? {}).length > 0 ? `：${JSON.stringify(alert.detail)}` : ''}`,
        at: alert.created_at.toISOString(),
      })),
    }
  })

  app.post('/api/v1/admin/export', async (request) => {
    const auth = requireSuperAdmin(app, request)
    if (!app.u3.configured) throw ApiError.serviceUnavailable('导出存储暂不可用', 30)
    const tables = [
      'class_members', 'profiles', 'follows', 'profile_likes', 'partner_posts', 'partner_responses',
      'tree_posts', 'tree_identity_map', 'tree_comments', 'tree_comment_identities', 'tree_reactions',
      'reports', 'moderation_actions', 'album_folders',
      'media_objects', 'time_capsules', 'capsule_recipients', 'capsule_contributors', 'notifications',
      'semantic_events', 'daily_metrics', 'audit_events',
    ] as const
    const data: Record<string, unknown[]> = {}
    await withTransaction(async (tx) => {
      for (const table of tables) {
        const result = await tx.query<Record<string, unknown>>(`SELECT * FROM ${table} WHERE class_id = $1`, [auth.classId])
        data[table] = result.rows
      }
      await writeAudit(tx, auditEntry(request, auth, 'data.export', 'class', auth.classId))
    })
    const createdAt = new Date()
    const key = `exports/${auth.classId}/${createdAt.toISOString().replaceAll(':', '-')}.json`
    await app.u3.putObject(app.u3.buckets.exports, key, JSON.stringify({ exportedAt: createdAt.toISOString(), classId: auth.classId, data }), 'application/json')
    const expiresAt = new Date(Date.now() + app.config.u3.presignExpirySeconds * 1000)
    const url = await app.u3.presignGet({
      bucket: app.u3.buckets.exports,
      key,
      responseContentDisposition: `attachment; filename="wepov-export-${createdAt.toISOString().slice(0, 10)}.json"`,
    })
    return { url, expiresAt: expiresAt.toISOString() }
  })

  app.get('/api/v1/admin/version-policy', async (request) => {
    requireSuperAdmin(app, request)
    return loadVersionPolicy(app)
  })

  app.put('/api/v1/admin/version-policy', async (request) => {
    const auth = requireSuperAdmin(app, request)
    const parsed = versionPolicySchema.safeParse(request.body)
    if (!parsed.success) throw validationError(parsed.error.issues)
    await withTransaction(async (tx) => {
      const before = await tx.queryOne<{ value: unknown }>(
        `SELECT value FROM app_settings WHERE class_id = $1 AND key = 'app.versionPolicy' FOR UPDATE`,
        [auth.classId],
      )
      await tx.query(
        `INSERT INTO app_settings (class_id, key, value) VALUES ($1,'app.versionPolicy',$2)
         ON CONFLICT (class_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [auth.classId, JSON.stringify(parsed.data)],
      )
      await writeAudit(tx, {
        ...auditEntry(request, auth, 'settings.version_policy_update', 'class', auth.classId),
        beforeState: before?.value ?? null,
        afterState: parsed.data,
      })
    })
    invalidateVersionPolicy()
    return parsed.data
  })
}
