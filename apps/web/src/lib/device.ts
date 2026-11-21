const DEVICE_ID_KEY = 'wepov.deviceId'

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY)
    if (existing && existing.length >= 16) return existing
    const created = `dev_${randomId()}`
    localStorage.setItem(DEVICE_ID_KEY, created)
    return created
  } catch {
    return `dev_${randomId()}`
  }
}

function detectPlatform(): string {
  const ua = navigator.userAgent
  if (/Android/i.test(ua)) return 'Android'
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS'
  if (/Windows/i.test(ua)) return 'Windows'
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macOS'
  if (/Linux/i.test(ua)) return 'Linux'
  return '未知系统'
}

function detectBrowser(): string {
  const ua = navigator.userAgent
  if (/Edg\//.test(ua)) return 'Edge'
  if (/Chrome\//.test(ua)) return 'Chrome'
  if (/Firefox\//.test(ua)) return 'Firefox'
  if (/Safari\//.test(ua)) return 'Safari'
  return '浏览器'
}

export function getDeviceName(): string {
  return `${detectPlatform()} · ${detectBrowser()}`
}

export function isAndroidApp(): boolean {
  const native = (window as WindowWithUpdater).WePOVUpdaterNative
  return typeof native === 'object' && native !== null
}

export interface UpdaterMirror {
  label: string
  url: string
  sha256: string
}

export type UpdaterPhase =
  | 'idle'
  | 'checking'
  | 'unknown'
  | 'up-to-date'
  | 'required'
  | 'hard-block'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'installing'
  | 'error'

export interface UpdaterStatus {
  phase: UpdaterPhase
  currentVersionName: string
  currentVersionCode: number
  latestVersionName: string | null
  latestVersionCode: number | null
  minSupportedVersionCode: number | null
  notes: string | null
  progress: number
  mirrorIndex: number
  mirrors: UpdaterMirror[]
  error: string | null
}

export interface WePOVUpdaterBridge {
  getStatus: () => UpdaterStatus
  check: () => void
  download: (mirrorIndex?: number) => void
  install: () => void
  quit: () => void
  subscribe: (listener: (status: UpdaterStatus) => void) => () => void
}

interface NativeUpdater {
  status: () => string
  check: () => void
  download: (mirrorIndex: number) => void
  install: () => void
  quit: () => void
}

export interface WindowWithUpdater extends Window {
  WePOVUpdater?: WePOVUpdaterBridge
  WePOVUpdaterNative?: NativeUpdater
  __wepovUpdatePush?: (raw: string) => void
}

let bridge: WePOVUpdaterBridge | null = null

function parseStatus(raw: string): UpdaterStatus | null {
  try {
    const parsed = JSON.parse(raw) as Partial<UpdaterStatus>
    if (typeof parsed.phase !== 'string') return null
    return {
      phase: parsed.phase,
      currentVersionName: parsed.currentVersionName ?? '',
      currentVersionCode: parsed.currentVersionCode ?? 0,
      latestVersionName: parsed.latestVersionName ?? null,
      latestVersionCode: parsed.latestVersionCode ?? null,
      minSupportedVersionCode: parsed.minSupportedVersionCode ?? null,
      notes: parsed.notes ?? null,
      progress: typeof parsed.progress === 'number' ? parsed.progress : 0,
      mirrorIndex: parsed.mirrorIndex ?? 0,
      mirrors: Array.isArray(parsed.mirrors) ? parsed.mirrors : [],
      error: parsed.error ?? null,
    }
  } catch {
    return null
  }
}

export function getUpdaterBridge(): WePOVUpdaterBridge | null {
  if (bridge) return bridge
  const win = window as WindowWithUpdater
  const native = win.WePOVUpdaterNative
  if (typeof native !== 'object' || native === null) return null

  let latest: UpdaterStatus | null = parseStatus(native.status())
  const listeners = new Set<(status: UpdaterStatus) => void>()

  win.__wepovUpdatePush = (raw: string) => {
    const next = parseStatus(raw)
    if (!next) return
    latest = next
    for (const listener of listeners) listener(next)
  }

  bridge = {
    getStatus: () => latest ?? parseStatus(native.status()) ?? emptyStatus(),
    check: () => native.check(),
    download: (index = 0) => native.download(index),
    install: () => native.install(),
    quit: () => native.quit(),
    subscribe: (listener) => {
      listeners.add(listener)
      const current = latest ?? parseStatus(native.status())
      if (current) listener(current)
      return () => listeners.delete(listener)
    },
  }
  return bridge
}

function emptyStatus(): UpdaterStatus {
  return {
    phase: 'idle',
    currentVersionName: '',
    currentVersionCode: 0,
    latestVersionName: null,
    latestVersionCode: null,
    minSupportedVersionCode: null,
    notes: null,
    progress: 0,
    mirrorIndex: 0,
    mirrors: [],
    error: null,
  }
}
