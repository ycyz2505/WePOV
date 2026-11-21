import type { FastifyInstance } from 'fastify'

/**
 * App update manifest (§15.7, §20.2).
 *
 * The JSON is **isomorphic** with the GitHub Release `update-manifest.json`
 * produced by the release workflow and consumed by the Android client
 * (`UpdateManifest.kt`). Do not re-wrap or reshape it: `apkUrl` is a single
 * string and `mirrors` is a separate array.
 */

export interface UpdateManifest {
  versionCode: number
  versionName: string
  minSupportedVersionCode: number
  apkUrl: string
  apkSha256: string
  releaseNotes: string
  publishedAt: string
  mirrors: string[]
}

interface CacheEntry {
  value: UpdateManifest
  expiresAt: number
}

let cache: CacheEntry | null = null

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/**
 * Normalise an upstream manifest without changing its shape. `mirrors` falls
 * back to the configured mirror prefixes when the release did not include any.
 */
function normalize(raw: unknown, app: FastifyInstance): UpdateManifest | null {
  if (typeof raw !== 'object' || raw === null) return null
  const obj = raw as Record<string, unknown>
  const versionName = obj['versionName']
  const versionCode = obj['versionCode']
  if (typeof versionName !== 'string' || versionCode === undefined || versionCode === null) return null

  const upstreamMirrors = asStringArray(obj['mirrors'])
  return {
    versionCode: asNumber(versionCode, 0),
    versionName,
    minSupportedVersionCode: asNumber(obj['minSupportedVersionCode'], app.config.minAppVersionCode),
    apkUrl: asString(obj['apkUrl']),
    apkSha256: asString(obj['apkSha256']),
    releaseNotes: asString(obj['releaseNotes']),
    publishedAt: asString(obj['publishedAt'], new Date().toISOString()),
    mirrors: upstreamMirrors.length > 0 ? upstreamMirrors : app.config.manifest.mirrors,
  }
}

function defaultManifest(app: FastifyInstance): UpdateManifest {
  return {
    versionCode: 0,
    versionName: '0.0.0',
    minSupportedVersionCode: app.config.minAppVersionCode,
    apkUrl: '',
    apkSha256: '',
    releaseNotes: '',
    publishedAt: new Date(0).toISOString(),
    mirrors: app.config.manifest.mirrors,
  }
}

/**
 * Load the manifest with a short cache. On failure we serve a stale cached
 * value when present, otherwise a minimal manifest built from config. This never
 * throws so a 426 response can always include a usable policy.
 */
export async function loadManifest(app: FastifyInstance): Promise<UpdateManifest> {
  const now = Date.now()
  if (cache && cache.expiresAt > now) return cache.value

  const source = resolveSource(app)
  if (!source) return defaultManifest(app)

  try {
    const response = await fetch(source, {
      headers: { Accept: 'application/json', 'User-Agent': 'wepov-api' },
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error(`manifest fetch ${response.status}`)
    const json = (await response.json()) as unknown
    const manifest = normalize(json, app)
    if (!manifest) throw new Error('manifest invalid')
    cache = { value: manifest, expiresAt: now + app.config.manifest.cacheSeconds * 1000 }
    return manifest
  } catch {
    if (cache) return cache.value
    return defaultManifest(app)
  }
}

function resolveSource(app: FastifyInstance): string | null {
  if (app.config.manifest.url) return app.config.manifest.url
  if (app.config.manifest.repo) {
    return `https://github.com/${app.config.manifest.repo}/releases/latest/download/update-manifest.json`
  }
  return null
}

export function clearManifestCache(): void {
  cache = null
}
