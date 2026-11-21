import { signal, computed } from '@preact/signals'
import type {
  AppVersionPolicy,
  Notification,
  Permission,
  SessionInfo,
  SessionMode,
  SessionUser,
} from './types'
import { ApiError, authApi, configureApi, gatewayApi } from './api'
import { getDeviceId, getDeviceName } from './device'

const TOKEN_KEY = 'wepov.token'
const PERSIST_MARKER = 'wepov.persist'

function readToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

function writeToken(token: string, mode: SessionMode): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token)
    if (mode === 'persistent') {
      localStorage.setItem(TOKEN_KEY, token)
      localStorage.setItem(PERSIST_MARKER, '1')
    }
  } catch {
    // storage unavailable; token lives only in memory below
  }
  memoryToken = token
}

function clearToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(PERSIST_MARKER)
  } catch {
    // ignore
  }
  memoryToken = null
}

let memoryToken: string | null = readToken()

export const gatewayVerified = signal<boolean>(false)
export const gatewayChecking = signal<boolean>(true)
export const currentUser = signal<SessionUser | null>(null)
export const sessionMode = signal<SessionMode>('temporary')
export const idleTimeoutMinutes = signal<number>(10)
export const authReady = signal<boolean>(false)
export const sessionExpired = signal<boolean>(false)

export const isAuthenticated = computed(() => currentUser.value !== null)
export const isAdmin = computed(() => {
  const role = currentUser.value?.role
  return role === 'general_admin' || role === 'super_admin'
})
export const isSuperAdmin = computed(() => currentUser.value?.role === 'super_admin')

export const unreadCount = signal<number>(0)
export const liveNotifications = signal<Notification[]>([])

let unauthorizedHandler: (() => void) | null = null
let versionGateHandler: ((policy: AppVersionPolicy | null) => void) | null = null

export function registerUnauthorized(handler: () => void): void {
  unauthorizedHandler = handler
}

export function registerVersionGate(
  handler: (policy: AppVersionPolicy | null) => void,
): void {
  versionGateHandler = handler
}

configureApi({
  getToken: () => memoryToken,
  unauthorized: () => {
    clearToken()
    currentUser.value = null
    sessionExpired.value = true
    unauthorizedHandler?.()
  },
  versionGate: (policy) => {
    versionGateHandler?.(policy)
  },
})

export function applySession(info: SessionInfo): void {
  currentUser.value = info.user
  sessionMode.value = info.mode
  idleTimeoutMinutes.value = info.idleTimeoutMinutes
  authReady.value = true
  sessionExpired.value = false
}

export function applyLogin(result: {
  user: SessionUser
  mode: SessionMode
  idleTimeoutMinutes: number
  token?: string
}): void {
  if (result.token) writeToken(result.token, result.mode)
  currentUser.value = result.user
  sessionMode.value = result.mode
  idleTimeoutMinutes.value = result.idleTimeoutMinutes
  authReady.value = true
  sessionExpired.value = false
}

export function clearSession(): void {
  currentUser.value = null
  unreadCount.value = 0
  liveNotifications.value = []
}

export async function checkGateway(): Promise<boolean> {
  gatewayChecking.value = true
  try {
    const status = await gatewayApi.status()
    gatewayVerified.value = status.verified
    return status.verified
  } catch {
    gatewayVerified.value = false
    return false
  } finally {
    gatewayChecking.value = false
  }
}

export async function verifyGateway(passcode: string, rememberDevice: boolean): Promise<void> {
  await gatewayApi.verify(passcode, rememberDevice)
  gatewayVerified.value = true
}

export async function loadSession(): Promise<SessionInfo | null> {
  if (!memoryToken) {
    authReady.value = true
    return null
  }
  try {
    const info = await authApi.session()
    applySession(info)
    return info
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      clearToken()
      currentUser.value = null
      authReady.value = true
      return null
    }
    authReady.value = true
    throw error
  }
}

export async function login(payload: {
  userId: string
  passwordInput: string
  mode: SessionMode
}): Promise<SessionUser> {
  const result = await authApi.login({
    userId: payload.userId,
    passwordInput: payload.passwordInput,
    mode: payload.mode,
    deviceId: getDeviceId(),
    deviceName: getDeviceName(),
  })
  applyLogin(result)
  return result.user
}

export async function logout(): Promise<void> {
  try {
    await authApi.logout()
  } catch {
    // best effort; local state cleared regardless
  } finally {
    clearToken()
    clearSession()
  }
}

export function logoutOnUnload(): void {
  if (!memoryToken) return
  authApi.logoutBeacon()
  if (sessionMode.value === 'temporary') clearToken()
}

export async function changePassword(payload: {
  currentPasswordInput: string
  newPassword: string
  confirmPassword: string
}): Promise<void> {
  await authApi.changePassword(payload)
  const user = currentUser.value
  if (user) currentUser.value = { ...user, mustChangePassword: false }
}

export async function setIdleTimeout(minutes: number): Promise<void> {
  const result = await authApi.updateIdleTimeout(minutes)
  idleTimeoutMinutes.value = result.idleTimeoutMinutes
}

export function hasPermission(permission: Permission): boolean {
  return currentUser.value?.permissions.includes(permission) ?? false
}

export function bumpUnread(delta: number): void {
  unreadCount.value = Math.max(0, unreadCount.value + delta)
}

export function pushLiveNotification(notification: Notification): void {
  liveNotifications.value = [notification, ...liveNotifications.value].slice(0, 50)
  if (!notification.readAt) bumpUnread(1)
}
