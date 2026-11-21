import type { FastifyPluginAsync } from 'fastify'
import { getPool } from '@wepov/database'
import { ApiError, validationError } from '../errors.js'
import { reportCreateSchema } from '../schemas.js'

const TARGETS = {
  tree_post: { table: 'tree_posts', id: 'id' },
  tree_comment: { table: 'tree_comments', id: 'id' },
  partner_post: { table: 'partner_posts', id: 'id' },
  profile: { table: 'profiles', id: 'user_id' },
  media: { table: 'media_objects', id: 'id' },
} as const

export const reportRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/v1/reports', async (request, reply) => {
    const auth = app.requireAuth(request)
    const parsed = reportCreateSchema.safeParse(request.body)
    if (!parsed.success) throw validationError(parsed.error.issues)
    const input = parsed.data
    const target = TARGETS[input.targetType]

    const exists = await getPool().query(
      `SELECT 1 FROM ${target.table} WHERE class_id = $1 AND ${target.id} = $2`,
      [auth.classId, input.targetId],
    )
    if (!exists.rows[0]) throw ApiError.notFound('report_target_not_found', '举报对象不存在')

    try {
      await getPool().query(
        `INSERT INTO reports (class_id, reporter_id, target_type, target_id, reason, details)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [auth.classId, auth.userId, input.targetType, input.targetId, input.reason, input.details],
      )
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw ApiError.conflict('report_already_open', '你已经举报过该内容，管理员正在处理')
      }
      throw error
    }
    reply.status(204).send()
  })
}
