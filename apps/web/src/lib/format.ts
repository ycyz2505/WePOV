const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
})

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
})

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = unit === 0 ? 0 : value >= 100 ? 0 : 1
  return `${value.toFixed(digits)} ${units[unit] ?? 'B'}`
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return dateTimeFormatter.format(date)
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return dateFormatter.format(date)
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return timeFormatter.format(date)
}

export function formatRelative(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '—'
  const time = new Date(iso).getTime()
  if (Number.isNaN(time)) return '—'
  const diffSeconds = Math.round((time - now) / 1000)
  const abs = Math.abs(diffSeconds)
  if (abs < 45) return diffSeconds >= 0 ? '即将' : '刚刚'
  if (abs < 3600) {
    const minutes = Math.round(abs / 60)
    return diffSeconds >= 0 ? `${minutes} 分钟后` : `${minutes} 分钟前`
  }
  if (abs < 86400) {
    const hours = Math.round(abs / 3600)
    return diffSeconds >= 0 ? `${hours} 小时后` : `${hours} 小时前`
  }
  if (abs < 86400 * 30) {
    const days = Math.round(abs / 86400)
    return diffSeconds >= 0 ? `${days} 天后` : `${days} 天前`
  }
  return formatDate(iso)
}

export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (days > 0) return `${days} 天 ${hours} 小时`
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

export function formatTimer(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function initialOf(name: string | null | undefined): string {
  if (!name) return '?'
  const first = Array.from(name.trim())[0]
  return first ?? '?'
}

function hashString(input: string): number {
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function avatarGradient(seed: string): string {
  const hash = hashString(seed)
  const hue = hash % 360
  const hue2 = (hue + 42 + (hash % 30)) % 360
  return `linear-gradient(140deg, hsl(${hue} 26% 64%), hsl(${hue2} 28% 46%))`
}

const GENDER_LABELS: Record<string, string> = {
  male: '男',
  female: '女',
  m: '男',
  f: '女',
  boy: '男',
  girl: '女',
  '男': '男',
  '女': '女',
  other: '其他',
  unknown: '未填写',
}

export function genderLabel(gender: string | null | undefined): string {
  if (!gender) return '未填写'
  return GENDER_LABELS[gender] ?? GENDER_LABELS[gender.toLowerCase()] ?? gender
}

export function percent(used: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.max(0, (used / total) * 100))
}
