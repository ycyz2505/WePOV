import type { FastifyInstance } from 'fastify'
import { getPool } from '@wepov/database'
import { ROLE_PERMISSIONS, type Role } from '@wepov/security'
import type { SessionUserDto } from '../dto.js'
import { avatarUrl } from './urls.js'

interface Row {
  user_id: string
  nickname: string
  real_name: string
  gender: string
  avatar_object_key: string | null
  must_change: boolean | null
  role: Role
}

/**
 * Load the `SessionUser` payload from the database. Used by login, refresh and
 * /auth/session so all three return byte-identical user objects.
 */
export async function loadSessionUser(
  app: FastifyInstance,
  classId: string,
  userId: string,
): Promise<SessionUserDto | null> {
  const result = await getPool().query<Row>(
    `SELECT p.user_id, p.nickname, cm.real_name, cm.gender, p.avatar_object_key,
            pc.must_change, COALESCE(ra.role, 'student') AS role
       FROM class_members cm
       JOIN profiles p ON p.user_id = cm.user_id AND p.class_id = cm.class_id
       JOIN users u ON u.id = cm.user_id AND u.is_active = true AND u.deleted_at IS NULL
       LEFT JOIN password_credentials pc ON pc.user_id = cm.user_id
       LEFT JOIN role_assignments ra
              ON ra.user_id = cm.user_id AND ra.class_id = cm.class_id AND ra.revoked_at IS NULL
      WHERE cm.class_id = $1 AND cm.user_id = $2
      LIMIT 1`,
    [classId, userId],
  )
  const row = result.rows[0]
  if (!row) return null
  return {
    id: row.user_id,
    nickname: row.nickname,
    realName: row.real_name,
    gender: row.gender,
    role: row.role,
    avatarUrl: await avatarUrl(app, row.avatar_object_key),
    permissions: ROLE_PERMISSIONS[row.role],
    mustChangePassword: row.must_change ?? false,
  }
}
