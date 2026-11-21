/**
 * Authorization (§2.2, packages/contracts permission constants).
 *
 * Two effective admin roles: general_admin (moderation + albumReview) and
 * super_admin (everything). Roles are NEVER trusted from the client; the API
 * resolves them from `role_assignments` on each request.
 */

export type Role = 'student' | 'general_admin' | 'super_admin'

export const PERMISSIONS = {
  rosterManage: 'roster:manage',
  roleManage: 'role:manage',
  moderation: 'moderation:manage',
  albumReview: 'album:review',
  albumManageAll: 'album:manage_all',
  recycleRestore: 'recycle:restore',
  treeRevealIdentity: 'tree:reveal_identity',
  logsRead: 'logs:read',
  securityManage: 'security:manage',
  settingsManage: 'settings:manage',
  dataExport: 'data:export',
} as const

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  student: [],
  general_admin: [PERMISSIONS.moderation, PERMISSIONS.albumReview],
  super_admin: Object.values(PERMISSIONS),
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission)
}

export function isAdmin(role: Role): boolean {
  return role === 'general_admin' || role === 'super_admin'
}

export function assertPermission(role: Role, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new AuthorizationError(permission)
  }
}

export class AuthorizationError extends Error {
  readonly permission: Permission
  constructor(permission: Permission) {
    super(`Missing permission: ${permission}`)
    this.name = 'AuthorizationError'
    this.permission = permission
  }
}
