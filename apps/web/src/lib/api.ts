import type {
  AlbumBreadcrumb,
  AlbumFolder,
  AlbumReviewItem,
  AdminReport,
  AdminUser,
  ApiErrorBody,
  AppVersionPolicy,
  BossSeason,
  CapsuleDetail,
  CapsuleSummary,
  CapsuleVisibility,
  ClassroomLayout,
  DeviceSession,
  FollowUser,
  FocusSession,
  GatewayMember,
  LogEntry,
  LoginResult,
  MediaItem,
  Notification,
  Page,
  PartnerKind,
  PartnerPost,
  PartnerResponse,
  ProfileDetail,
  ProfileSearchQuery,
  RecycleEntry,
  RosterImportResult,
  SecuritySettings,
  SemanticEvent,
  SessionInfo,
  SessionMode,
  SessionUser,
  StorageUsage,
  TrafficStats,
  TreeComment,
  TreeIdentityReveal,
  TreePost,
  UploadTier,
  UploadTicket,
} from './types'

const API_BASE = '/api/v1'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly requestId: string
  readonly details: unknown
  readonly retryAfterSeconds: number | null

  constructor(status: number, body: ApiErrorBody, retryAfterSeconds: number | null) {
    super(body.message)
    this.name = 'ApiError'
    this.status = status
    this.code = body.code
    this.requestId = body.requestId
    this.details = body.details
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export class VersionGateError extends Error {
  readonly policy: AppVersionPolicy | null
  constructor(policy: AppVersionPolicy | null) {
    super('当前版本过低，需要更新后才能继续使用')
    this.name = 'VersionGateError'
    this.policy = policy
  }
}

export class NetworkError extends Error {
  constructor(message = '网络不可用，请检查连接后重试') {
    super(message)
    this.name = 'NetworkError'
  }
}

type TokenSource = () => string | null

let tokenSource: TokenSource = () => null
let onUnauthorized: (() => void) | null = null
let onVersionGate: ((policy: AppVersionPolicy | null) => void) | null = null

export function configureApi(options: {
  getToken: TokenSource
  unauthorized?: () => void
  versionGate?: (policy: AppVersionPolicy | null) => void
}): void {
  tokenSource = options.getToken
  onUnauthorized = options.unauthorized ?? null
  onVersionGate = options.versionGate ?? null
}

interface RequestOptions {
  method?: string
  body?: unknown
  signal?: AbortSignal
  idempotencyKey?: string
  query?: Record<string, string | number | boolean | null | undefined>
  raw?: boolean
  skipAuth?: boolean
  retryOn429?: boolean
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(`${API_BASE}${path}`, window.location.origin)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === null || value === undefined) continue
      url.searchParams.set(key, String(value))
    }
  }
  return url.pathname + url.search
}

async function parseError(response: Response): Promise<ApiError> {
  const retryAfter = response.headers.get('retry-after')
  const retrySeconds = retryAfter ? Number.parseInt(retryAfter, 10) : null
  let body: ApiErrorBody = {
    code: `http_${response.status}`,
    message: '请求失败，请稍后重试',
    requestId: '',
  }
  try {
    const parsed = (await response.json()) as Partial<ApiErrorBody>
    body = {
      code: typeof parsed.code === 'string' ? parsed.code : body.code,
      message: typeof parsed.message === 'string' ? parsed.message : body.message,
      requestId: typeof parsed.requestId === 'string' ? parsed.requestId : '',
      details: parsed.details,
    }
  } catch {
    // response had no JSON body; keep defaults
  }
  return new ApiError(response.status, body, Number.isFinite(retrySeconds) ? retrySeconds : null)
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' })
  const token = options.skipAuth ? null : tokenSource()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey)

  let bodyInit: BodyInit | undefined
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json')
    bodyInit = JSON.stringify(options.body)
  }

  let response: Response
  try {
    response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? (bodyInit ? 'POST' : 'GET'),
      headers,
      body: bodyInit,
      credentials: 'same-origin',
      signal: options.signal ?? null,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new NetworkError()
  }

  if (response.status === 426) {
    let policy: AppVersionPolicy | null = null
    try {
      policy = (await response.json()) as AppVersionPolicy
    } catch {
      policy = null
    }
    onVersionGate?.(policy)
    throw new VersionGateError(policy)
  }

  if (response.status === 401) {
    onUnauthorized?.()
    throw await parseError(response)
  }

  if (response.status === 429 || response.status === 503) {
    const error = await parseError(response)
    if (options.retryOn429 && error.retryAfterSeconds !== null && error.retryAfterSeconds <= 5) {
      await new Promise((resolve) => setTimeout(resolve, error.retryAfterSeconds! * 1000))
      return request<T>(path, { ...options, retryOn429: false })
    }
    throw error
  }

  if (!response.ok) throw await parseError(response)

  if (response.status === 204) return undefined as T
  if (options.raw) return response as unknown as T
  return (await response.json()) as T
}

/* ─────────────────────────── Gateway ─────────────────────────── */

export const gatewayApi = {
  status: (): Promise<{ verified: boolean; rememberDevice: boolean }> =>
    request('/gateway/status', { skipAuth: true }),
  verify: (passcode: string, rememberDevice: boolean): Promise<{ verified: boolean }> =>
    request('/gateway/verify', {
      method: 'POST',
      body: { passcode, rememberDevice },
      skipAuth: true,
    }),
  members: (): Promise<{ items: GatewayMember[] }> => request('/gateway/members', { skipAuth: true }),
}

/* ─────────────────────────── First-run setup ─────────────────────────── */

export const setupApi = {
  status: (): Promise<{ initialized: boolean }> => request('/setup/status', { skipAuth: true }),
  initialize: (payload: {
    passcode: string
    realName: string
    nickname: string
    password: string
  }): Promise<{ initialized: boolean; classId: string; superAdminId: string }> =>
    request('/setup/initialize', { method: 'POST', body: payload, skipAuth: true }),
}

/* ─────────────────────────── Auth ─────────────────────────── */

export const authApi = {
  login: (payload: {
    userId: string
    passwordInput: string
    mode: SessionMode
    deviceId: string
    deviceName: string
  }): Promise<LoginResult> => request('/auth/login', { method: 'POST', body: payload, skipAuth: true }),
  session: (): Promise<SessionInfo> => request('/auth/session'),
  logout: (): Promise<void> => request('/auth/logout', { method: 'POST' }),
  logoutBeacon: (): void => {
    const token = tokenSource()
    const payload = JSON.stringify({ token })
    if (navigator.sendBeacon) {
      navigator.sendBeacon(`${API_BASE}/auth/logout`, new Blob([payload], { type: 'application/json' }))
    }
  },
  changePassword: (payload: {
    currentPasswordInput: string
    newPassword: string
    confirmPassword: string
  }): Promise<{ ok: true }> => request('/auth/password', { method: 'POST', body: payload }),
  updateIdleTimeout: (minutes: number): Promise<{ idleTimeoutMinutes: number }> =>
    request('/auth/idle-timeout', { method: 'PATCH', body: { minutes } }),
}

/* ─────────────────────────── Sessions / devices ─────────────────────────── */

export const sessionApi = {
  list: (): Promise<{ items: DeviceSession[] }> => request('/sessions'),
  revoke: (id: string): Promise<void> => request(`/sessions/${id}`, { method: 'DELETE' }),
  revokeAll: (): Promise<void> => request('/sessions', { method: 'DELETE' }),
}

/* ─────────────────────────── Profiles / plaza ─────────────────────────── */

export const profileApi = {
  list: (query: ProfileSearchQuery): Promise<Page<ProfileDetail>> =>
    request('/profiles', {
      query: {
        q: query.q,
        sort: query.sort,
        filter: query.filter,
        gender: query.gender,
        cursor: query.cursor,
        limit: query.limit,
      },
    }),
  get: (userId: string): Promise<ProfileDetail> => request(`/profiles/${userId}`),
  me: (): Promise<ProfileDetail> => request('/profiles/me'),
  update: (payload: {
    nickname?: string
    birthday?: string | null
    birthdayVisible?: boolean
    signature?: string
    introduction?: string
    avatarObjectKey?: string | null
    backgroundObjectKey?: string | null
  }): Promise<ProfileDetail> => request('/profiles/me', { method: 'PATCH', body: payload }),
  uploadAsset: (payload: {
    kind: 'avatar' | 'background'
    mime: string
    dataBase64: string
  }): Promise<{ objectKey: string; bytes: number; sha256: string }> =>
    request('/profiles/me/assets', { method: 'POST', body: payload }),
  followers: (userId: string, cursor?: string): Promise<Page<FollowUser>> =>
    request(`/profiles/${userId}/followers`, { query: { cursor } }),
  following: (userId: string, cursor?: string): Promise<Page<FollowUser>> =>
    request(`/profiles/${userId}/following`, { query: { cursor } }),
  likers: (userId: string, cursor?: string): Promise<Page<FollowUser>> =>
    request(`/profiles/${userId}/likes`, { query: { cursor } }),
}

export const followApi = {
  follow: (userId: string): Promise<{ following: boolean; mutual: boolean }> =>
    request(`/follows/${userId}`, { method: 'PUT' }),
  unfollow: (userId: string): Promise<{ following: boolean; mutual: boolean }> =>
    request(`/follows/${userId}`, { method: 'DELETE' }),
  like: (userId: string): Promise<{ likeCount: number }> =>
    request(`/likes/${userId}`, { method: 'POST' }),
}

/* ─────────────────────────── Tree hole ─────────────────────────── */

export const treeApi = {
  list: (query: {
    sort?: 'latest' | 'active' | 'saved'
    tag?: string
    cursor?: string
    limit?: number
  }): Promise<Page<TreePost>> => request('/tree', { query }),
  get: (id: string): Promise<TreePost> => request(`/tree/${id}`),
  create: (payload: {
    content: string
    tags: string[]
    allowBulletScreen: boolean
    poll?: { question: string; options: string[]; multiple: boolean }
  }): Promise<TreePost> => request('/tree', { method: 'POST', body: payload }),
  remove: (id: string): Promise<void> => request(`/tree/${id}`, { method: 'DELETE' }),
  comments: (id: string, cursor?: string): Promise<Page<TreeComment>> =>
    request(`/tree/${id}/comments`, { query: { cursor } }),
  comment: (
    id: string,
    payload: { content: string; parentCommentId: string | null },
  ): Promise<TreeComment> => request(`/tree/${id}/comments`, { method: 'POST', body: payload }),
  react: (id: string, emoji: string): Promise<{ reactions: TreePost['reactions'] }> =>
    request(`/tree/${id}/reactions`, { method: 'POST', body: { emoji } }),
  vote: (id: string, optionIds: string[]): Promise<{ poll: TreePost['poll'] }> =>
    request(`/tree/${id}/vote`, { method: 'POST', body: { optionIds } }),
  save: (id: string, saved: boolean): Promise<{ saved: boolean }> =>
    request(`/tree/${id}/save`, { method: 'PUT', body: { saved } }),
  bullets: (tag?: string): Promise<{ items: Array<{ id: string; content: string; tags: string[] }> }> =>
    request('/tree/bullets', { query: { tag } }),
  mine: (cursor?: string): Promise<Page<TreePost>> => request('/tree/mine', { query: { cursor } }),
  report: (payload: {
    targetType: 'tree_post' | 'tree_comment' | 'partner_post' | 'profile' | 'media'
    targetId: string
    reason: string
    details: string
  }): Promise<void> => request('/reports', { method: 'POST', body: payload }),
  revealIdentity: (postId: string): Promise<TreeIdentityReveal> =>
    request(`/tree/${postId}/identity`, { method: 'POST' }),
}

/* ─────────────────────────── Partners ─────────────────────────── */

export const partnerApi = {
  list: (query: { status?: string; cursor?: string }): Promise<Page<PartnerPost>> =>
    request('/partners', { query }),
  get: (id: string): Promise<PartnerPost> => request(`/partners/${id}`),
  create: (payload: {
    title: string
    kind: PartnerKind
    startsAt: string
    location: string
    capacity: number
    expiresAt: string
    description: string
    allowWaitlist: boolean
  }): Promise<PartnerPost> => request('/partners', { method: 'POST', body: payload }),
  respond: (id: string, note: string): Promise<{ state: PartnerPost['myResponse'] }> =>
    request(`/partners/${id}/responses`, { method: 'POST', body: { note } }),
  responses: (id: string): Promise<{ items: PartnerResponse[] }> =>
    request(`/partners/${id}/responses`),
  confirm: (id: string, userId: string): Promise<{ ok: true }> =>
    request(`/partners/${id}/responses/${userId}/confirm`, { method: 'POST' }),
  close: (id: string): Promise<PartnerPost> => request(`/partners/${id}/close`, { method: 'POST' }),
  cancel: (id: string): Promise<void> => request(`/partners/${id}`, { method: 'DELETE' }),
}

/* ─────────────────────────── Album ─────────────────────────── */

export const albumApi = {
  folders: (parentId: string | null): Promise<{ items: AlbumFolder[]; breadcrumb: AlbumBreadcrumb[] }> =>
    request('/albums/folders', { query: { parentId } }),
  createFolder: (parentId: string | null, name: string): Promise<AlbumFolder> =>
    request('/albums/folders', { method: 'POST', body: { parentId, name } }),
  requestFolderChange: (
    folderId: string,
    payload:
      | { operation: 'move'; targetParentId: string | null; reason: string }
      | { operation: 'delete'; reason: string },
  ): Promise<void> => request(`/albums/folders/${folderId}/requests`, { method: 'POST', body: payload }),
  media: (folderId: string | null, cursor?: string): Promise<Page<MediaItem>> =>
    request('/albums/media', { query: { folderId, cursor } }),
  requestDelete: (mediaId: string, reason: string): Promise<void> =>
    request(`/albums/media/${mediaId}/delete-request`, { method: 'POST', body: { reason } }),
  storage: (): Promise<StorageUsage> => request('/albums/storage'),
  downloadZipTicket: (mediaIds: string[]): Promise<{ items: Array<{ id: string; url: string; filename: string }> }> =>
    request('/albums/download', { method: 'POST', body: { mediaIds } }),
}

export const uploadApi = {
  intent: (payload: {
    folderId: string
    filename: string
    mime: string
    originalBytes: number
    finalBytes: number
    width: number
    height: number
    sha256: string
    tier: UploadTier
    capturedAt: string | null
    preserveOriginalBytes: boolean
  }): Promise<UploadTicket> => request('/uploads/intent', { method: 'POST', body: payload }),
  complete: (uploadId: string): Promise<MediaItem> =>
    request(`/uploads/${uploadId}/complete`, { method: 'POST' }),
}

/* ─────────────────────────── Capsules ─────────────────────────── */

export const capsuleApi = {
  list: (query: { cursor?: string }): Promise<Page<CapsuleSummary>> =>
    request('/capsules', { query }),
  get: (id: string): Promise<CapsuleDetail> => request(`/capsules/${id}`),
  create: (payload: {
    title: string
    content: string
    visibility: CapsuleVisibility
    recipientIds: string[]
    unlockAt: string
    contributionDeadline: string
    mediaObjectKeys: string[]
  }): Promise<CapsuleSummary> => request('/capsules', { method: 'POST', body: payload }),
  contribute: (id: string, content: string, mediaObjectKeys: string[]): Promise<CapsuleSummary> =>
    request(`/capsules/${id}/contributions`, { method: 'POST', body: { content, mediaObjectKeys } }),
  delay: (id: string, unlockAt: string): Promise<CapsuleSummary> =>
    request(`/capsules/${id}/unlock-at`, { method: 'PATCH', body: { unlockAt } }),
}

/* ─────────────────────────── Classroom / Boss ─────────────────────────── */

export const classroomApi = {
  layout: (): Promise<ClassroomLayout> => request('/classroom/layout'),
  setPresence: (presence: 'focus' | 'rest' | 'offline', note: string): Promise<ClassroomLayout> =>
    request('/classroom/presence', { method: 'PUT', body: { presence, note } }),
  startFocus: (durationMinutes: number, note: string): Promise<FocusSession> =>
    request('/classroom/focus', { method: 'POST', body: { durationMinutes, note } }),
  endFocus: (): Promise<void> => request('/classroom/focus', { method: 'DELETE' }),
  encourage: (payload: {
    recipientId: string
    kind: 'note' | 'snack' | 'lamp'
    message: string
  }): Promise<void> => request('/classroom/encouragements', { method: 'POST', body: payload }),
  gift: (recipientId: string, gift: string): Promise<void> =>
    request('/classroom/gifts', { method: 'POST', body: { recipientId, gift } }),
  boss: (): Promise<BossSeason> => request('/boss/current'),
}

/* ─────────────────────────── Notifications ─────────────────────────── */

export const notificationApi = {
  list: (cursor?: string): Promise<Page<Notification>> => request('/notifications', { query: { cursor } }),
  unreadCount: (): Promise<{ count: number }> => request('/notifications/unread-count'),
  markRead: (id: string): Promise<void> => request(`/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: (): Promise<void> => request('/notifications/read-all', { method: 'POST' }),
  updatePreferences: (prefs: Record<string, boolean>): Promise<void> =>
    request('/notifications/preferences', { method: 'PATCH', body: prefs }),
}

/* ─────────────────────────── Admin ─────────────────────────── */

export const adminApi = {
  reports: (query: { status?: string; cursor?: string }): Promise<Page<AdminReport>> =>
    request('/admin/moderation/reports', { query }),
  moderate: (
    payload: {
      targetType: string
      targetId: string
      action: 'hide' | 'remove' | 'collapse' | 'restore' | 'mute' | 'unmute'
      reason: string
      showReasonToSubject: boolean
      showOperator: boolean
      durationMinutes?: number
    },
  ): Promise<void> => request('/admin/moderation/actions', { method: 'POST', body: payload }),
  albumQueue: (cursor?: string): Promise<Page<AlbumReviewItem>> =>
    request('/admin/moderation/album', { query: { cursor } }),
  albumDecide: (id: string, decision: 'approve' | 'reject'): Promise<void> =>
    request(`/admin/moderation/album/${id}`, { method: 'POST', body: { decision } }),
  roster: (cursor?: string): Promise<Page<AdminUser>> => request('/admin/roster', { query: { cursor } }),
  importRoster: (csv: string): Promise<RosterImportResult> =>
    request('/admin/roster/import', { method: 'POST', body: { csv } }),
  updateRole: (userId: string, role: 'student' | 'general_admin' | 'super_admin'): Promise<void> =>
    request(`/admin/roster/${userId}/role`, { method: 'PUT', body: { role } }),
  hideUser: (userId: string, hidden: boolean): Promise<void> =>
    request(`/admin/roster/${userId}/visibility`, { method: 'PUT', body: { hidden } }),
  resetPassword: (userId: string): Promise<{ initialPassword: string }> =>
    request(`/admin/roster/${userId}/reset-password`, { method: 'POST' }),
  recycle: (cursor?: string): Promise<Page<RecycleEntry>> => request('/admin/recycle', { query: { cursor } }),
  restoreRecycle: (id: string): Promise<void> =>
    request(`/admin/recycle/${id}/restore`, { method: 'POST' }),
  purgeRecycle: (id: string): Promise<void> => request(`/admin/recycle/${id}`, { method: 'DELETE' }),
  traffic: (range: 'today' | '7d' | '30d'): Promise<TrafficStats> =>
    request('/admin/logs/traffic', { query: { range } }),
  logs: (query: {
    route?: string
    status?: string
    requestId?: string
    cursor?: string
  }): Promise<Page<LogEntry>> => request('/admin/logs/http', { query }),
  semantic: (query: { kind?: string; cursor?: string }): Promise<Page<SemanticEvent>> =>
    request('/admin/logs/semantic', { query }),
  security: (): Promise<SecuritySettings> => request('/admin/security'),
  exportData: (): Promise<{ url: string; expiresAt: string }> =>
    request('/admin/export', { method: 'POST' }),
  versionPolicy: (): Promise<AppVersionPolicy> => request('/admin/version-policy'),
  updateVersionPolicy: (payload: {
    minSupportedVersionCode: number
    latestVersionName: string
    latestVersionCode: number
    notes: string
  }): Promise<AppVersionPolicy> => request('/admin/version-policy', { method: 'PUT', body: payload }),
}

/* ─────────────────────────── Session probe (public) ─────────────────────────── */

export function fetchSessionUser(): Promise<SessionUser> {
  return request<SessionInfo>('/auth/session').then((info) => info.user)
}

export { API_BASE }
