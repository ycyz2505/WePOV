import type { FastifyPluginAsync } from 'fastify'
import { getPool, withTransaction } from '@wepov/database'
import {
  hashGatewayPasscode,
  hashPassword,
  writeAudit,
} from '@wepov/security'
import { ApiError, validationError } from '../errors.js'
import { setupInitializeSchema } from '../schemas.js'

/**
 * First-run setup.
 *
 * The deployment ships with no class, no passcode and no super admin. The first
 * person to open the site sets the class passcode and the super administrator
 * credentials themselves; the account is created with `must_change = false`
 * because the person choosing the password is the account holder.
 *
 * The endpoint is public (there is no gateway yet) but can only ever succeed
 * once: the class row is created inside a transaction guarded by an advisory
 * lock, and any second attempt sees an existing class and gets 409.
 */

const SETUP_LOCK = 0x7765_706f_7602

const DEFAULT_SETTINGS: Array<[string, unknown]> = [
  ['media.quotaBytes', 9_878_424_780],
  ['media.warnRatio', 0.15],
  ['media.blockRatio', 0.05],
  ['gateway.passcodeVersion', 1],
  ['boss.dailyCaps', { focus: 3, resource: 2, answer: 5, mutual_help: 3, challenge: 1 }],
  ['notifications.defaults', { sound: true, badge: true }],
]

export const setupRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/setup/status', async () => {
    const result = await getPool().query(`SELECT 1 FROM classes LIMIT 1`)
    return { initialized: result.rowCount !== null && result.rowCount > 0 }
  })

  app.post('/api/v1/setup/initialize', async (request, reply) => {
    const parsed = setupInitializeSchema.safeParse(request.body)
    if (!parsed.success) throw validationError(parsed.error.issues)
    const { passcode, realName, nickname, password } = parsed.data

    const nicknameNorm = nickname.normalize('NFKC').toLocaleLowerCase('zh-CN')
    const credential = await hashPassword(app.config.security.passwordMatchKey, password)

    const created = await withTransaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock($1)', [SETUP_LOCK])

      const existing = await tx.query('SELECT 1 FROM classes LIMIT 1')
      if ((existing.rowCount ?? 0) > 0) {
        throw ApiError.conflict('already_initialized', '班级已经初始化，请直接输入班级口令')
      }

      const gatewayHash = hashGatewayPasscode(app.config.gatewayPepper, 1, passcode)
      const classRow = await tx.query<{ id: string }>(
        `INSERT INTO classes (name, gateway_passcode_hash, gateway_passcode_version)
         VALUES ($1, $2, 1) RETURNING id`,
        ['第一人称班级', gatewayHash],
      )
      const classId = classRow.rows[0]!.id

      const userRow = await tx.query<{ id: string }>(`INSERT INTO users DEFAULT VALUES RETURNING id`)
      const userId = userRow.rows[0]!.id

      await tx.query(
        `INSERT INTO class_members (class_id, user_id, real_name, gender)
         VALUES ($1, $2, $3, $4)`,
        [classId, userId, realName, '未设置'],
      )
      await tx.query(
        `INSERT INTO profiles (user_id, class_id, nickname, nickname_norm, birthday_visible)
         VALUES ($1, $2, $3, $4, true)`,
        [userId, classId, nickname, nicknameNorm],
      )
      await tx.query(
        `INSERT INTO password_credentials
           (user_id, password_hash, password_length, match_tag, must_change)
         VALUES ($1, $2, $3, $4, false)`,
        [userId, credential.hash, credential.length, credential.matchTag],
      )
      await tx.query(
        `INSERT INTO role_assignments (class_id, user_id, role) VALUES ($1, $2, 'super_admin')`,
        [classId, userId],
      )
      await tx.query(
        `INSERT INTO storage_usage (class_id, used_bytes, quota_bytes) VALUES ($1, 0, $2)`,
        [classId, app.config.mediaQuotaBytesDefault],
      )
      for (const [key, value] of DEFAULT_SETTINGS) {
        await tx.query(`INSERT INTO app_settings (class_id, key, value) VALUES ($1, $2, $3)`, [
          classId,
          key,
          JSON.stringify(value),
        ])
      }
      await tx.query(
        `INSERT INTO seat_layouts (class_id, name, columns, rows, is_active, seats, created_by)
         VALUES ($1, '默认座位', 6, 6, true, '[]'::jsonb, $2)`,
        [classId, userId],
      )

      await writeAudit(tx, {
        classId,
        actorId: userId,
        actorRole: 'super_admin',
        action: 'setup.initialize',
        targetType: 'class',
        targetId: classId,
        requestId: (request as { requestId?: string }).requestId ?? null,
        ipHmac: request.ipHmac,
      })

      return { classId, userId }
    })

    reply.status(201)
    return { initialized: true, classId: created.classId, superAdminId: created.userId }
  })
}
