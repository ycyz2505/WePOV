import { z } from 'zod'

export const roleSchema = z.enum(['student', 'general_admin', 'super_admin'])
export type Role = z.infer<typeof roleSchema>

export const sessionModeSchema = z.enum(['temporary', 'persistent'])
export type SessionMode = z.infer<typeof sessionModeSchema>

export const idSchema = z.string().uuid()
export const cursorSchema = z.string().min(1).max(512).optional()
export const pageQuerySchema = z.object({
  cursor: cursorSchema,
  limit: z.coerce.number().int().min(1).max(100).default(30),
})

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  requestId: z.string(),
  details: z.unknown().optional(),
})
export type ApiError = z.infer<typeof apiErrorSchema>

export const gatewayVerifySchema = z.object({
  passcode: z.string().min(4).max(128),
  rememberDevice: z.boolean().default(false),
})

export const loginSchema = z.object({
  userId: idSchema,
  passwordInput: z.string().min(1).max(256),
  mode: sessionModeSchema,
  deviceId: z.string().min(16).max(128),
  deviceName: z.string().trim().min(1).max(80),
})

export const changePasswordSchema = z
  .object({
    currentPasswordInput: z.string().min(1).max(256),
    newPassword: z.string().min(8).max(64),
    confirmPassword: z.string().min(8).max(64),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ['confirmPassword'],
    message: '两次输入的密码不一致',
  })

export const profileSchema = z.object({
  userId: idSchema,
  nickname: z.string().min(1).max(12),
  realName: z.string().min(1).max(30),
  gender: z.string().min(1).max(20),
  birthday: z.string().date().nullable(),
  birthdayVisible: z.boolean(),
  signature: z.string().max(30),
  introduction: z.string().max(200),
  avatarUrl: z.string().url().nullable(),
  backgroundUrl: z.string().url().nullable(),
  followingCount: z.number().int().nonnegative(),
  followerCount: z.number().int().nonnegative(),
  likeCount: z.number().int().nonnegative(),
  isFollowing: z.boolean(),
  isMutual: z.boolean(),
  updatedAt: z.string().datetime(),
})
export type Profile = z.infer<typeof profileSchema>

export const updateProfileSchema = z.object({
  nickname: z.string().trim().min(1).max(12).optional(),
  birthday: z.string().date().nullable().optional(),
  birthdayVisible: z.boolean().optional(),
  signature: z.string().trim().max(30).optional(),
  introduction: z.string().trim().max(200).optional(),
  avatarObjectKey: z.string().max(512).nullable().optional(),
  backgroundObjectKey: z.string().max(512).nullable().optional(),
})

export const treePostCreateSchema = z.object({
  content: z.string().trim().min(1).max(3000),
  tags: z.array(z.string().trim().min(1).max(20)).max(5).default([]),
  allowBulletScreen: z.boolean().default(false),
  poll: z
    .object({
      question: z.string().trim().min(1).max(120),
      options: z.array(z.string().trim().min(1).max(80)).min(2).max(8),
      multiple: z.boolean().default(false),
    })
    .optional(),
})

export const treeCommentCreateSchema = z.object({
  content: z.string().trim().min(1).max(1000),
  parentCommentId: idSchema.nullable().default(null),
})

export const partnerKindSchema = z.enum([
  'meal',
  'study',
  'sport',
  'entertainment',
  'travel',
  'activity',
  'other',
])

export const partnerCreateSchema = z.object({
  title: z.string().trim().min(1).max(80),
  kind: partnerKindSchema,
  startsAt: z.string().datetime(),
  location: z.string().trim().min(1).max(120),
  capacity: z.number().int().min(2).max(60),
  expiresAt: z.string().datetime(),
  description: z.string().trim().max(800).default(''),
  allowWaitlist: z.boolean().default(true),
})

export const partnerRespondSchema = z.object({
  note: z.string().trim().max(120).default(''),
})

export const uploadTierSchema = z.enum(['original', 'high', 'standard', 'compact', 'custom'])
export const uploadIntentSchema = z.object({
  folderId: idSchema,
  filename: z.string().min(1).max(255),
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']),
  originalBytes: z.number().int().positive().max(40 * 1024 * 1024),
  finalBytes: z.number().int().positive().max(40 * 1024 * 1024),
  width: z.number().int().positive().max(20000),
  height: z.number().int().positive().max(20000),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  tier: uploadTierSchema,
  capturedAt: z.string().datetime().nullable().default(null),
  preserveOriginalBytes: z.boolean().default(false),
})

export const mediaDeleteRequestSchema = z.object({
  reason: z.string().trim().max(500).default(''),
})

export const folderCreateSchema = z.object({
  parentId: idSchema.nullable().default(null),
  name: z.string().trim().min(1).max(80),
})

export const folderChangeRequestSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('move'),
    targetParentId: idSchema.nullable(),
    reason: z.string().trim().max(500).default(''),
  }),
  z.object({
    operation: z.literal('delete'),
    reason: z.string().trim().max(500).default(''),
  }),
])

export const capsuleVisibilitySchema = z.enum(['class', 'recipient', 'self', 'collaborative'])
export const capsuleCreateSchema = z.object({
  title: z.string().trim().min(1).max(100),
  content: z.string().trim().min(1).max(10000),
  visibility: capsuleVisibilitySchema,
  recipientIds: z.array(idSchema).max(60).default([]),
  unlockAt: z.string().datetime(),
  contributionDeadline: z.string().datetime(),
  mediaObjectKeys: z.array(z.string().max(512)).max(20).default([]),
})

export const focusStartSchema = z.object({
  durationMinutes: z.number().int().min(5).max(240),
  note: z.string().trim().max(80).default(''),
})

export const encouragementSchema = z.object({
  recipientId: idSchema,
  kind: z.enum(['note', 'snack', 'lamp']),
  message: z.string().trim().max(120).default(''),
})

export const bossContributionKindSchema = z.enum([
  'focus',
  'resource',
  'answer',
  'mutual_help',
  'challenge',
])

export const reportCreateSchema = z.object({
  targetType: z.enum(['tree_post', 'tree_comment', 'partner_post', 'profile', 'media']),
  targetId: idSchema,
  reason: z.enum(['harassment', 'bullying', 'privacy', 'sexual', 'danger', 'spam', 'other']),
  details: z.string().trim().max(500).default(''),
})

export const moderationSchema = z.object({
  action: z.enum(['hide', 'remove', 'collapse', 'restore', 'mute', 'unmute']),
  reason: z.string().trim().max(500).default(''),
  showReasonToSubject: z.boolean().default(false),
  showOperator: z.boolean().default(false),
  durationMinutes: z.number().int().min(1).max(30 * 24 * 60).optional(),
})

export const rosterImportRowSchema = z.object({
  studentNumber: z.string().trim().max(30).default(''),
  realName: z.string().trim().min(1).max(30),
  gender: z.string().trim().min(1).max(20),
  nickname: z.string().trim().min(1).max(12),
  initialPassword: z.string().min(8).max(64).optional(),
})

export const notificationSchema = z.object({
  id: idSchema,
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  href: z.string().nullable(),
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
})
export type Notification = z.infer<typeof notificationSchema>

export const permission = {
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

export type Permission = (typeof permission)[keyof typeof permission]

export const rolePermissions: Record<Role, readonly Permission[]> = {
  student: [],
  general_admin: [permission.moderation, permission.albumReview],
  super_admin: Object.values(permission),
}
