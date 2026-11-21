import { z } from 'zod'

/**
 * Request schemas for the API. These mirror `packages/contracts` but are kept
 * local so the API build does not pull workspace TS source into its output.
 */

export const sessionModeSchema = z.enum(['temporary', 'persistent'])

export const gatewayVerifySchema = z.object({
  passcode: z.string().min(4).max(128),
  rememberDevice: z.boolean().default(false),
})

export const loginSchema = z.object({
  userId: z.string().uuid(),
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
  parentCommentId: z.string().uuid().nullable().default(null),
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
  folderId: z.string().uuid(),
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
  parentId: z.string().uuid().nullable().default(null),
  name: z.string().trim().min(1).max(80),
})

export const folderChangeRequestSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('move'),
    targetParentId: z.string().uuid().nullable(),
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
  recipientIds: z.array(z.string().uuid()).max(60).default([]),
  unlockAt: z.string().datetime(),
  contributionDeadline: z.string().datetime(),
  mediaObjectKeys: z.array(z.string().max(512)).max(20).default([]),
})

export const capsuleContributionSchema = z.object({
  content: z.string().trim().min(1).max(10000),
  mediaObjectKeys: z.array(z.string().max(512)).max(20).default([]),
})

export const capsuleDelaySchema = z.object({
  unlockAt: z.string().datetime(),
})

export const focusStartSchema = z.object({
  durationMinutes: z.number().int().min(5).max(240),
  note: z.string().trim().max(80).default(''),
})

export const encouragementSchema = z.object({
  recipientId: z.string().uuid(),
  kind: z.enum(['note', 'snack', 'lamp']),
  message: z.string().trim().max(120).default(''),
})

export const giftSchema = z.object({
  recipientId: z.string().uuid(),
  gift: z.string().trim().min(1).max(40),
})

export const presenceSchema = z.object({
  presence: z.enum(['focus', 'rest', 'offline']),
  note: z.string().trim().max(80).default(''),
})

export const reportCreateSchema = z.object({
  targetType: z.enum(['tree_post', 'tree_comment', 'partner_post', 'profile', 'media']),
  targetId: z.string().uuid(),
  reason: z.enum(['harassment', 'bullying', 'privacy', 'sexual', 'danger', 'spam', 'other']),
  details: z.string().trim().max(500).default(''),
})

export const moderationSchema = z.object({
  targetType: z.string().min(1).max(40),
  targetId: z.string().uuid(),
  action: z.enum(['hide', 'remove', 'collapse', 'restore', 'mute', 'unmute']),
  reason: z.string().trim().max(500).default(''),
  showReasonToSubject: z.boolean().default(false),
  showOperator: z.boolean().default(false),
  durationMinutes: z.number().int().min(1).max(43200).optional(),
})

export const albumDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
})

export const rosterImportSchema = z.object({
  csv: z.string().min(1).max(500_000),
})

export const roleUpdateSchema = z.object({
  role: z.enum(['student', 'general_admin', 'super_admin']),
})

export const visibilityUpdateSchema = z.object({
  hidden: z.boolean(),
})

export const versionPolicySchema = z.object({
  minSupportedVersionCode: z.number().int().min(0),
  latestVersionName: z.string().trim().min(1).max(40),
  latestVersionCode: z.number().int().min(0),
  notes: z.string().trim().max(1000),
})

export const idleTimeoutSchema = z.object({
  minutes: z.number().int().min(1).max(120),
})

export const reactionSchema = z.object({
  emoji: z.enum(['like', 'hug', 'wow', 'sad']),
})

export const voteSchema = z.object({
  optionIds: z.array(z.string().min(1).max(40)).min(1).max(8),
})

export const saveSchema = z.object({
  saved: z.boolean(),
})

export const downloadSchema = z.object({
  mediaIds: z.array(z.string().uuid()).min(1).max(50),
})

export const notificationPreferencesSchema = z.record(z.string(), z.boolean())
