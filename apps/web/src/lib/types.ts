import type {
  Permission,
  Profile,
  Role,
  SessionMode,
  Notification as ContractNotification,
} from '@wepov/contracts'

export type { Permission, Profile, Role, SessionMode }

export interface ApiErrorBody {
  code: string
  message: string
  requestId: string
  details?: unknown
}

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

export interface SessionUser {
  id: string
  nickname: string
  realName: string
  role: Role
  gender: string
  avatarUrl: string | null
  permissions: Permission[]
  mustChangePassword: boolean
}

export interface SessionInfo {
  user: SessionUser
  mode: SessionMode
  idleTimeoutMinutes: number
  issuedAt: string
  expiresAt: string
}

export interface LoginResult {
  user: SessionUser
  mode: SessionMode
  idleTimeoutMinutes: number
  token?: string
}

export interface GatewayMember {
  userId: string
  nickname: string
  realName: string
  avatarUrl: string | null
  pinyinInitials: string
  gender: string
}

export interface DeviceSession {
  id: string
  deviceName: string
  mode: SessionMode
  current: boolean
  lastSeenAt: string
  createdAt: string
}

export interface ProfileDetail extends Profile {
  pinyinInitials: string
  backgroundPreset?: string | null
}

export interface ProfileSearchQuery {
  q?: string
  sort?: 'recent' | 'nickname' | 'likes' | 'followers'
  filter?: 'all' | 'following' | 'followers' | 'mutual' | 'not_following'
  gender?: string
  cursor?: string
  limit?: number
}

export interface FollowUser {
  userId: string
  nickname: string
  realName: string
  avatarUrl: string | null
  gender: string
  isFollowing: boolean
  isMutual: boolean
}

export interface TreePost {
  id: string
  alias: string
  isOp: boolean
  content: string
  tags: string[]
  allowBulletScreen: boolean
  poll: TreePoll | null
  reactions: TreeReactionSummary[]
  commentCount: number
  createdAt: string
  updatedAt: string
  isMine: boolean
  saved: boolean
  moderation: ModerationState | null
}

export interface TreePoll {
  question: string
  multiple: boolean
  options: Array<{ id: string; label: string; votes: number; voted: boolean }>
  totalVotes: number
}

export interface TreeReactionSummary {
  emoji: string
  count: number
  reacted: boolean
}

export interface TreeComment {
  id: string
  alias: string
  isOp: boolean
  content: string
  parentCommentId: string | null
  createdAt: string
  isMine: boolean
  moderation: ModerationState | null
}

export interface ModerationState {
  action: 'hide' | 'remove' | 'collapse'
  placeholder: string
  reason: string | null
  operatorName: string | null
  createdAt: string
}

export interface PartnerPost {
  id: string
  title: string
  kind: PartnerKind
  startsAt: string
  location: string
  capacity: number
  confirmedCount: number
  waitlistCount: number
  expiresAt: string
  description: string
  allowWaitlist: boolean
  status: 'open' | 'formed' | 'closed' | 'expired' | 'cancelled'
  ownerId: string
  ownerNickname: string
  myResponse: PartnerResponseState | null
  createdAt: string
}

export type PartnerKind =
  | 'meal'
  | 'study'
  | 'sport'
  | 'entertainment'
  | 'travel'
  | 'activity'
  | 'other'

export type PartnerResponseState = 'pending' | 'confirmed' | 'waitlist' | 'declined'

export interface PartnerResponse {
  id: string
  userId: string
  nickname: string
  note: string
  state: PartnerResponseState
  createdAt: string
}

export interface AlbumFolder {
  id: string
  parentId: string | null
  name: string
  depth: number
  mediaCount: number
  folderCount: number
  pendingChange: 'move' | 'delete' | null
  createdAt: string
}

export interface AlbumBreadcrumb {
  id: string | null
  name: string
}

export interface MediaItem {
  id: string
  folderId: string
  filename: string
  width: number
  height: number
  finalBytes: number
  originalBytes: number
  tier: UploadTier
  reviewStatus: 'approved' | 'pending_delete' | 'hidden' | 'recycled'
  thumbnailUrl: string | null
  previewUrl: string | null
  downloadUrl: string | null
  uploadedAt: string
  uploaderNickname: string
  duplicateOf: string | null
}

export type UploadTier = 'original' | 'high' | 'standard' | 'compact' | 'custom'

export interface StorageUsage {
  totalBytes: number
  usedBytes: number
  mediaBytes: number
  logBytes: number
  tempBytes: number
  uploadEnabled: boolean
  deleteOnly: boolean
  warning: boolean
}

export interface UploadTicket {
  uploadId: string
  objectKey: string
  uploadUrl: string
  method: 'PUT' | 'POST'
  headers: Record<string, string>
  expiresAt: string
  quarantine: boolean
}

export interface CapsuleSummary {
  id: string
  title: string
  visibility: CapsuleVisibility
  unlockAt: string
  contributionDeadline: string
  locked: boolean
  contributorCount: number
  recipientCount: number
  createdAt: string
  canContribute: boolean
}

export type CapsuleVisibility = 'class' | 'recipient' | 'self' | 'collaborative'

export interface CapsuleDetail extends CapsuleSummary {
  content: string | null
  contributors: Array<{ userId: string; nickname: string; avatarUrl: string | null }>
  recipients: Array<{ userId: string; nickname: string; avatarUrl: string | null }>
  mediaUrls: string[]
}

export interface ClassroomSeat {
  seatId: string
  row: number
  column: number
  userId: string | null
  nickname: string | null
  avatarUrl: string | null
  gender: string | null
  presence: 'focus' | 'rest' | 'offline'
  focusUntil: string | null
  focusNote: string | null
}

export interface ClassroomLayout {
  rows: number
  columns: number
  seats: ClassroomSeat[]
  boss: BossSeason | null
  me: ClassroomSeat | null
}

export interface BossSeason {
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

export interface FocusSession {
  id: string
  durationMinutes: number
  note: string
  startedAt: string
  endsAt: string
  active: boolean
}

export type Notification = ContractNotification

export interface AdminReport {
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

export interface AlbumReviewItem {
  id: string
  type: 'media_delete' | 'folder_move' | 'folder_delete'
  subjectNickname: string
  reason: string
  targetName: string
  createdAt: string
  mediaId: string | null
  folderId: string | null
}

export interface RecycleEntry {
  id: string
  kind: string
  label: string
  deletedByNickname: string
  deletedAt: string
  restorable: boolean
}

export interface RosterImportResult {
  created: number
  updated: number
  skipped: number
  errors: Array<{ line: number; message: string }>
  generatedPasswords: Array<{ studentNumber: string; realName: string; initialPassword: string }>
}

export interface TrafficStats {
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

export interface LogEntry {
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

export interface SemanticEvent {
  id: string
  at: string
  kind: string
  actorSummary: string
  targetSummary: string
  detail: string
}

export interface SecuritySettings {
  classPasscodeRotatedAt: string | null
  activeSessionCount: number
  abnormalSessionCount: number
  alerts: Array<{ id: string; level: 'info' | 'warn' | 'critical'; message: string; at: string }>
}

export interface AppVersionPolicy {
  minSupportedVersionCode: number
  latestVersionName: string
  latestVersionCode: number
  notes: string
}

export interface AdminUser {
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

export interface TreeIdentityReveal {
  postId: string
  userId: string
  realName: string
  studentNumber: string
  revealedAt: string
  auditId: string
}
