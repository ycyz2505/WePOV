/**
 * Shared row / enum types for the WePOV database layer.
 *
 * These types intentionally mirror the SQL schema. They are plain interfaces so
 * the API can consume them without importing anything from `pg`.
 */

export type Role = 'student' | 'general_admin' | 'super_admin'

export type SessionMode = 'temporary' | 'persistent'

export type TreeContentStatus = 'visible' | 'hidden' | 'removed' | 'collapsed'

export type PartnerKind =
  | 'meal'
  | 'study'
  | 'sport'
  | 'entertainment'
  | 'travel'
  | 'activity'
  | 'other'

export type PartnerStatus = 'open' | 'full' | 'closed' | 'expired' | 'cancelled'

export type PartnerResponseStatus =
  | 'pending'
  | 'accepted'
  | 'waitlist'
  | 'declined'
  | 'cancelled'

export type MediaStatus =
  | 'quarantine'
  | 'active'
  | 'hidden'
  | 'pending_delete'
  | 'deleted'

export type CapsuleVisibility = 'class' | 'recipient' | 'self' | 'collaborative'

export type BossContributionKind =
  | 'focus'
  | 'resource'
  | 'answer'
  | 'mutual_help'
  | 'challenge'

export interface ClassRow {
  id: string
  name: string
  gateway_passcode_hash: string
  gateway_passcode_version: number
  created_at: Date
  updated_at: Date
}

export interface UserRow {
  id: string
  is_active: boolean
  deleted_at: Date | null
  created_at: Date
}

export interface ClassMemberRow {
  id: string
  class_id: string
  user_id: string
  student_number: string | null
  real_name: string
  real_name_pinyin: string
  gender: string
  hidden: boolean
  joined_at: Date
}

export interface ProfileRow {
  user_id: string
  class_id: string
  nickname: string
  nickname_norm: string
  nickname_pinyin: string
  birthday_enc: string | null
  birthday_visible: boolean
  signature: string
  introduction: string
  avatar_object_key: string | null
  background_object_key: string | null
  like_count: number
  following_count: number
  follower_count: number
  version: number
  updated_at: Date
}

export interface PasswordCredentialRow {
  user_id: string
  password_hash: string
  password_length: number
  match_tag: string
  match_tag_version: number
  must_change: boolean
  updated_at: Date
}

export interface SessionFamilyRow {
  id: string
  class_id: string
  user_id: string
  device_id: string
  mode: SessionMode
  absolute_expires_at: Date
  revoked_at: Date | null
  revoked_reason: string | null
  created_at: Date
}

export interface SessionRow {
  id: string
  family_id: string
  class_id: string
  user_id: string
  device_id: string
  mode: SessionMode
  access_token_hash: string
  refresh_token_hash: string | null
  previous_refresh_token_hash: string | null
  idle_expires_at: Date
  last_used_at: Date
  revoked_at: Date | null
  revoked_reason: string | null
  created_at: Date
}

export interface NotificationRow {
  seq: string
  id: string
  class_id: string
  user_id: string
  kind: string
  title: string
  body: string
  href: string | null
  read_at: Date | null
  created_at: Date
}

export interface AuditEventRow {
  id: string
  class_id: string
  actor_id: string | null
  actor_role: string
  action: string
  target_type: string | null
  target_id: string | null
  before_state: unknown
  after_state: unknown
  session_id: string | null
  request_id: string | null
  ip_hmac: string | null
  created_at: Date
}

/** Default per-kind Boss contribution caps (anti-farm, §11.3). */
export const DEFAULT_BOSS_DAILY_CAPS: Record<BossContributionKind, number> = {
  focus: 3,
  resource: 2,
  answer: 5,
  mutual_help: 3,
  challenge: 1,
}

/** Default points awarded per behaviour kind. Points are never client supplied. */
export const DEFAULT_BOSS_POINTS: Record<BossContributionKind, number> = {
  focus: 10,
  resource: 15,
  answer: 8,
  mutual_help: 6,
  challenge: 20,
}

/** Media upload constraints shared by API and database CHECK constraints. */
export const MEDIA_LIMITS = {
  maxOriginalBytes: 40 * 1024 * 1024,
  maxPixels: 60_000_000,
  maxDimension: 20_000,
  maxFolderDepth: 10,
  defaultMediaQuotaBytes: Math.round(9.2 * 1024 * 1024 * 1024),
  warnRemainingRatio: 0.15,
  blockRemainingRatio: 0.05,
} as const
