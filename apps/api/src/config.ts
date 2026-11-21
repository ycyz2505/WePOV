import { loadSecurityConfig, type SecurityConfig } from '@wepov/security'

/**
 * Runtime configuration for the API. Everything the server needs is read once
 * at boot from the environment; a missing required value fails fast.
 */

export interface U3Config {
  endpoint: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle: boolean
  mediaBucket: string
  logBucket: string
  exportBucket: string
  presignExpirySeconds: number
}

export interface ManifestConfig {
  /** owner/repo on GitHub, e.g. "wepov/wepov". */
  repo: string | null
  /** Explicit manifest URL; overrides the GitHub latest-release URL. */
  url: string | null
  cacheSeconds: number
  /** Download mirror prefixes tried by the app in order. */
  mirrors: string[]
}

export interface AppConfig {
  nodeEnv: string
  isProduction: boolean
  port: number
  host: string
  databaseUrl: string
  publicOrigin: string
  security: SecurityConfig
  /** Raw string used to hash the shared class gateway passcode. */
  gatewayPepper: string
  minAppVersionCode: number
  trustedProxyHops: number
  u3: U3Config
  manifest: ManifestConfig
  maintenanceSecret: string | null
  bodyLimitBytes: number
  logLevel: string
  mediaQuotaBytesDefault: number
}

function str(env: NodeJS.ProcessEnv, name: string, fallback?: string): string {
  const value = env[name]
  if (value !== undefined && value.length > 0) return value
  if (fallback !== undefined) return fallback
  throw new Error(`Missing required environment variable: ${name}`)
}

function int(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const value = env[name]
  if (value === undefined || value.length === 0) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) throw new Error(`Environment variable ${name} must be an integer`)
  return parsed
}

function bool(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const value = env[name]
  if (value === undefined || value.length === 0) return fallback
  return value === '1' || value.toLowerCase() === 'true'
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = str(env, 'NODE_ENV', 'development')
  const isProduction = nodeEnv === 'production'

  const security = loadSecurityConfig({
    SESSION_PEPPER: env['SESSION_PEPPER'],
    PASSWORD_MATCH_KEY: env['PASSWORD_MATCH_KEY'],
    ABUSE_HMAC_KEY: env['ABUSE_HMAC_KEY'],
    LOG_IP_HMAC_KEY: env['LOG_IP_HMAC_KEY'],
    TREE_IDENTITY_HMAC_KEY: env['TREE_IDENTITY_HMAC_KEY'],
    DATA_ENCRYPTION_KEY: env['DATA_ENCRYPTION_KEY'],
    DATA_ENCRYPTION_KEY_VERSION: env['DATA_ENCRYPTION_KEY_VERSION'],
    DATA_ENCRYPTION_KEY_PREVIOUS: env['DATA_ENCRYPTION_KEY_PREVIOUS'],
  })

  const mirrorsRaw = env['UPDATE_MANIFEST_MIRRORS'] ?? ''
  const mirrors = mirrorsRaw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

  return {
    nodeEnv,
    isProduction,
    port: int(env, 'PORT', 3000),
    host: '0.0.0.0',
    databaseUrl: str(env, 'DATABASE_URL'),
    publicOrigin: str(env, 'PUBLIC_ORIGIN', 'http://localhost:3000'),
    security,
    gatewayPepper: str(env, 'CLASS_GATEWAY_PEPPER', str(env, 'SESSION_PEPPER')),
    minAppVersionCode: int(env, 'MIN_APP_VERSION_CODE', 0),
    trustedProxyHops: int(env, 'TRUSTED_PROXY_HOPS', 0),
    u3: {
      endpoint: str(env, 'U3_ENDPOINT', ''),
      region: str(env, 'U3_REGION', 'auto'),
      accessKeyId: str(env, 'U3_ACCESS_KEY_ID', ''),
      secretAccessKey: str(env, 'U3_SECRET_ACCESS_KEY', ''),
      forcePathStyle: bool(env, 'U3_FORCE_PATH_STYLE', true),
      mediaBucket: str(env, 'U3_MEDIA_BUCKET', 'wepov-media'),
      logBucket: str(env, 'U3_LOG_BUCKET', 'wepov-logs'),
      exportBucket: str(env, 'U3_EXPORT_BUCKET', 'wepov-export'),
      presignExpirySeconds: int(env, 'U3_PRESIGN_EXPIRY_SECONDS', 900),
    },
    manifest: {
      repo: env['GITHUB_REPO'] && env['GITHUB_REPO'].length > 0 ? env['GITHUB_REPO'] : null,
      url:
        env['UPDATE_MANIFEST_URL'] && env['UPDATE_MANIFEST_URL'].length > 0
          ? env['UPDATE_MANIFEST_URL']
          : null,
      cacheSeconds: int(env, 'UPDATE_MANIFEST_CACHE_SECONDS', 300),
      mirrors,
    },
    maintenanceSecret:
      env['MAINTENANCE_SIGNING_SECRET'] && env['MAINTENANCE_SIGNING_SECRET'].length > 0
        ? env['MAINTENANCE_SIGNING_SECRET']
        : null,
    bodyLimitBytes: int(env, 'BODY_LIMIT_BYTES', 1024 * 1024),
    logLevel: str(env, 'LOG_LEVEL', 'info'),
    mediaQuotaBytesDefault: int(env, 'MEDIA_QUOTA_BYTES', 9_878_424_780),
  }
}
