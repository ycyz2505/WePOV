import type { FastifyInstance } from 'fastify'
import { getPool } from '@wepov/database'
import { loadManifest } from './manifest.js'

/**
 * Effective app version policy.
 *
 * The admin UI stores `{ minSupportedVersionCode, latestVersionName,
 * latestVersionCode, notes }` in `app_settings` under `app.versionPolicy`.
 * That is a *different* shape from the release update-manifest, so we keep it
 * separate. The version gate only needs `minSupportedVersionCode`, which we
 * cache briefly to avoid a DB read on every request.
 */

export interface AppVersionPolicy {
  minSupportedVersionCode: number
  latestVersionName: string
  latestVersionCode: number
  notes: string
}

const SETTING_KEY = 'app.versionPolicy'
const CACHE_MS = 30_000

let cached: { value: AppVersionPolicy; at: number } | null = null

function fromConfig(app: FastifyInstance): AppVersionPolicy {
  return {
    minSupportedVersionCode: app.config.minAppVersionCode,
    latestVersionName: '0.0.0',
    latestVersionCode: 0,
    notes: '',
  }
}

function parsePolicy(raw: unknown, app: FastifyInstance): AppVersionPolicy {
  if (typeof raw !== 'object' || raw === null) return fromConfig(app)
  const obj = raw as Record<string, unknown>
  const min = Number(obj['minSupportedVersionCode'])
  const latestCode = Number(obj['latestVersionCode'])
  return {
    minSupportedVersionCode: Number.isFinite(min) ? min : app.config.minAppVersionCode,
    latestVersionName: typeof obj['latestVersionName'] === 'string' ? obj['latestVersionName'] : '0.0.0',
    latestVersionCode: Number.isFinite(latestCode) ? latestCode : 0,
    notes: typeof obj['notes'] === 'string' ? obj['notes'] : '',
  }
}

export async function loadVersionPolicy(app: FastifyInstance): Promise<AppVersionPolicy> {
  const now = Date.now()
  if (cached && now - cached.at < CACHE_MS) return cached.value
  try {
    const result = await getPool().query<{ value: unknown }>(
      `SELECT value FROM app_settings WHERE key = $1 ORDER BY updated_at DESC LIMIT 1`,
      [SETTING_KEY],
    )
    const row = result.rows[0]
    const value = row ? parsePolicy(row.value, app) : fromConfig(app)
    cached = { value, at: now }
    return value
  } catch {
    // A DB hiccup must not block requests on the gate; fall back to config.
    return cached?.value ?? fromConfig(app)
  }
}

export function invalidateVersionPolicy(): void {
  cached = null
}

export async function saveVersionPolicy(
  classId: string,
  policy: AppVersionPolicy,
): Promise<AppVersionPolicy> {
  await getPool().query(
    `INSERT INTO app_settings (class_id, key, value)
     VALUES ($1, $2, $3)
     ON CONFLICT (class_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [classId, SETTING_KEY, JSON.stringify(policy)],
  )
  invalidateVersionPolicy()
  return policy
}

/** Convenience for the 426 path: the full manifest the client should download. */
export async function manifestForUpgrade(app: FastifyInstance) {
  return loadManifest(app)
}
