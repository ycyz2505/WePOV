import type { FastifyInstance } from 'fastify'
import { ROLE_PERMISSIONS, type Role } from '@wepov/security'
import type { AuthContext } from '../types.js'
import { avatarUrl } from './urls.js'

/**
 * The `SessionUser` shape the frontend consumes (`apps/web/src/lib/types.ts`).
 * Field names are load-bearing: the login page, header and permission checks all
 * read these exact keys.
 */
export interface SessionUserDto {
  id: string
  nickname: string
  realName: string
  role: Role
  gender: string
  avatarUrl: string | null
  permissions: readonly string[]
  mustChangePassword: boolean
}

export async function toSessionUser(
  app: FastifyInstance,
  auth: AuthContext,
): Promise<SessionUserDto> {
  return {
    id: auth.userId,
    nickname: auth.nickname,
    realName: auth.realName,
    role: auth.role,
    gender: auth.gender,
    avatarUrl: await avatarUrl(app, auth.avatarObjectKey),
    permissions: ROLE_PERMISSIONS[auth.role],
    mustChangePassword: auth.mustChangePassword,
  }
}

/** ISO string for a Date or null. */
export function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

/** ISO string, required. */
export function isoRequired(value: Date): string {
  return value.toISOString()
}
