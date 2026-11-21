import type { Role } from '@wepov/security'

/**
 * Response contracts — the single source of truth is
 * `apps/web/src/lib/types.ts`; this file mirrors it for the server.
 *
 * The web client was built against those field names, so every route must
 * return exactly these keys. Anything not listed here (raw DB row names,
 * snake_case columns, internal columns) must never reach the client.
 *
 * Request *validation* lives in `schemas.ts`; this file is response shape only.
 */

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

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

export interface SessionInfoDto {
  user: SessionUserDto
  mode: 'temporary' | 'persistent'
  idleTimeoutMinutes: number
  issuedAt: string
  expiresAt: string
}

export interface LoginResultDto {
  user: SessionUserDto
  mode: 'temporary' | 'persistent'
  idleTimeoutMinutes: number
  token?: string
}

export interface GatewayMemberDto {
  userId: string
  nickname: string
  realName: string
  avatarUrl: string | null
  pinyinInitials: string
  gender: string
}

export interface DeviceSessionDto {
  id: string
  deviceName: string
  mode: 'temporary' | 'persistent'
  current: boolean
  lastSeenAt: string
  createdAt: string
}

export interface ProfileDetailDto {
  userId: string
  nickname: string
  realName: string
  gender: string
  birthday: string | null
  birthdayVisible: boolean
  signature: string
  introduction: string
  avatarUrl: string | null
  backgroundUrl: string | null
  followingCount: number
  followerCount: number
  likeCount: number
  isFollowing: boolean
  isMutual: boolean
  updatedAt: string
  pinyinInitials: string
  backgroundPreset?: string | null
}

export interface FollowUserDto {
  userId: string
  nickname: string
  realName: string
  avatarUrl: string | null
  gender: string
  isFollowing: boolean
  isMutual: boolean
}

export type ModerationAction = 'hide' | 'remove' | 'collapse'

export interface ModerationStateDto {
  action: ModerationAction
  placeholder: string
  reason: string | null
  operatorName: string | null
  createdAt: string
}

export interface TreeReactionSummaryDto {
  emoji: string
  count: number
  reacted: boolean
}

export interface TreePollOptionDto {
  id: string
  label: string
  votes: number
  voted: boolean
}

export interface TreePollDto {
  question: string
  multiple: boolean
  options: TreePollOptionDto[]
  totalVotes: number
}

export interface TreePostDto {
  id: string
  alias: string
  isOp: boolean
  content: string
  tags: string[]
  allowBulletScreen: boolean
  poll: TreePollDto | null
  reactions: TreeReactionSummaryDto[]
  commentCount: number
  createdAt: string
  updatedAt: string
  isMine: boolean
  saved: boolean
  moderation: ModerationStateDto | null
}

export interface TreeCommentDto {
  id: string
  alias: string
  isOp: boolean
  content: string
  parentCommentId: string | null
  createdAt: string
  isMine: boolean
  moderation: ModerationStateDto | null
}

export interface TreeIdentityRevealDto {
  postId: string
  userId: string
  realName: string
  studentNumber: string
  revealedAt: string
  auditId: string
}

export type PartnerKindDto =
  | 'meal'
  | 'study'
  | 'sport'
  | 'entertainment'
  | 'travel'
  | 'activity'
  | 'other'

export type PartnerStatusDto = 'open' | 'formed' | 'closed' | 'expired' | 'cancelled'
export type PartnerResponseStateDto = 'pending' | 'confirmed' | 'waitlist' | 'declined'

export interface PartnerPostDto {
  id: string
  title: string
  kind: PartnerKindDto
  startsAt: string
  location: string
  capacity: number
  confirmedCount: number
  waitlistCount: number
  expiresAt: string
  description: string
  allowWaitlist: boolean
  status: PartnerStatusDto
  ownerId: string
  ownerNickname: string
  myResponse: PartnerResponseStateDto | null
  createdAt: string
}

export interface PartnerResponseDto {
  id: string
  userId: string
  nickname: string
  note: string
  state: PartnerResponseStateDto
  createdAt: string
}

export interface AlbumFolderDto {
  id: string
  parentId: string | null
  name: string
  depth: number
  mediaCount: number
  folderCount: number
  pendingChange: 'move' | 'delete' | null
  createdAt: string
}

export interface AlbumBreadcrumbDto {
  id: string | null
  name: string
}

export type UploadTierDto = 'original' | 'high' | 'standard' | 'compact' | 'custom'
export type MediaReviewStatusDto = 'approved' | 'pending_delete' | 'hidden' | 'recycled'

export interface MediaItemDto {
  id: string
  folderId: string
  filename: string
  width: number
  height: number
  finalBytes: number
  originalBytes: number
  tier: UploadTierDto
  reviewStatus: MediaReviewStatusDto
  thumbnailUrl: string | null
  previewUrl: string | null
  downloadUrl: string | null
  uploadedAt: string
  uploaderNickname: string
  duplicateOf: string | null
}

export interface StorageUsageDto {
  totalBytes: number
  usedBytes: number
  mediaBytes: number
  logBytes: number
  tempBytes: number
  uploadEnabled: boolean
  deleteOnly: boolean
  warning: boolean
}

export interface UploadTicketDto {
  uploadId: string
  objectKey: string
  uploadUrl: string
  method: 'PUT' | 'POST'
  headers: Record<string, string>
  expiresAt: string
  quarantine: boolean
}

export type CapsuleVisibilityDto = 'class' | 'recipient' | 'self' | 'collaborative'

export interface CapsuleSummaryDto {
  id: string
  title: string
  visibility: CapsuleVisibilityDto
  unlockAt: string
  contributionDeadline: string
  locked: boolean
  contributorCount: number
  recipientCount: number
  createdAt: string
  canContribute: boolean
}

export interface CapsulePersonDto {
  userId: string
  nickname: string
  avatarUrl: string | null
}

export interface CapsuleDetailDto extends CapsuleSummaryDto {
  content: string | null
  contributors: CapsulePersonDto[]
  recipients: CapsulePersonDto[]
  mediaUrls: string[]
}

export type PresenceDto = 'focus' | 'rest' | 'offline'

export interface ClassroomSeatDto {
  seatId: string
  row: number
  column: number
  userId: string | null
  nickname: string | null
  avatarUrl: string | null
  gender: string | null
  presence: PresenceDto
  focusUntil: string | null
  focusNote: string | null
}

export interface BossSeasonDto {
  id: string
  name: string
  description: string
  targetPoints: number
  currentPoints: number
  startsAt: string
  endsAt: string
  reward: string
  status: 'upcoming' | 'active' | 'ended'
}

export interface ClassroomLayoutDto {
  rows: number
  columns: number
  seats: ClassroomSeatDto[]
  boss: BossSeasonDto | null
  me: ClassroomSeatDto | null
}

export interface FocusSessionDto {
  id: string
  durationMinutes: number
  note: string
  startedAt: string
  endsAt: string
  active: boolean
}

export interface NotificationDto {
  id: string
  kind: string
  title: string
  body: string
  href: string | null
  readAt: string | null
  createdAt: string
}

export interface AdminReportDto {
  id: string
  targetType: string
  targetId: string
  reason: string
  details: string
  status: 'open' | 'resolved' | 'dismissed'
  reporterNickname: string | null
  createdAt: string
  preview: string
}

export interface AlbumReviewItemDto {
  id: string
  type: 'media_delete' | 'folder_move' | 'folder_delete'
  subjectNickname: string
  reason: string
  targetName: string
  createdAt: string
  mediaId: string | null
  folderId: string | null
}

export interface RecycleEntryDto {
  id: string
  kind: string
  label: string
  deletedByNickname: string
  deletedAt: string
  restorable: boolean
}

export interface RosterImportResultDto {
  created: number
  updated: number
  skipped: number
  errors: Array<{ line: number; message: string }>
  generatedPasswords: Array<{ studentNumber: string; realName: string; initialPassword: string }>
}

export interface TrafficStatsDto {
  range: 'today' | '7d' | '30d'
  pv: number
  uv: number
  activeUsers: number
  peakQps: number
  p50Ms: number
  p95Ms: number
  errorRate: number
  loginFailures: number
  throttled: number
  moduleUsage: Array<{ module: string; count: number }>
  storageGrowthBytes: number
  moderationActions: number
  identityReveals: number
}

export interface LogEntryDto {
  id: string
  requestId: string
  at: string
  route: string
  method: string
  status: number
  durationMs: number
  responseBytes: number
  accountSummary: string | null
  deviceSummary: string | null
  ip: string | null
  userAgent: string | null
  category: string | null
}

export interface SemanticEventDto {
  id: string
  at: string
  kind: string
  actorSummary: string
  targetSummary: string
  detail: string
}

export interface SecuritySettingsDto {
  classPasscodeRotatedAt: string | null
  activeSessionCount: number
  abnormalSessionCount: number
  alerts: Array<{ id: string; level: 'info' | 'warn' | 'critical'; message: string; at: string }>
}

export interface AppVersionPolicyDto {
  minSupportedVersionCode: number
  latestVersionName: string
  latestVersionCode: number
  notes: string
}

export interface AdminUserDto {
  id: string
  studentNumber: string
  realName: string
  nickname: string
  gender: string
  role: Role
  hidden: boolean
  mustChangePassword: boolean
  createdAt: string
}
