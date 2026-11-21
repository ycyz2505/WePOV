import { createHash, hkdfSync } from 'node:crypto'
import { Keyring } from './encryption.js'

/**
 * Security configuration and key derivation.
 *
 * The design (§4.4, §6.2, §14.2, §15.3) requires several *independent* secrets:
 * session token pepper, password match tag key, abuse (rate-limit/ban) pseudonym
 * key, log IP correlation key, tree identity HMAC key and an AES-256-GCM
 * keyring. Distinct env vars are preferred. When one is absent we derive a
 * domain-separated subkey from SESSION_PEPPER via HKDF, so keys remain
 * cryptographically independent even with a minimal env.
 */

export interface SecurityConfig {
  sessionPepper: Buffer
  passwordMatchKey: Buffer
  abuseKey: Buffer
  logIpKey: Buffer
  treeIdentityKey: Buffer
  encryption: Keyring
  /** True when any secret was derived rather than supplied explicitly. */
  derivedKeys: string[]
}

export interface SecurityEnv {
  SESSION_PEPPER?: string | undefined
  PASSWORD_MATCH_KEY?: string | undefined
  ABUSE_HMAC_KEY?: string | undefined
  LOG_IP_HMAC_KEY?: string | undefined
  TREE_IDENTITY_HMAC_KEY?: string | undefined
  DATA_ENCRYPTION_KEY?: string | undefined
  DATA_ENCRYPTION_KEY_VERSION?: string | undefined
  DATA_ENCRYPTION_KEY_PREVIOUS?: string | undefined
}

const HKDF_SALT = Buffer.from('wepov-security-v1', 'utf8')

function hkdf(ikm: Buffer, label: string): Buffer {
  const out = hkdfSync('sha256', ikm, HKDF_SALT, Buffer.from(label, 'utf8'), 32)
  return Buffer.from(out)
}

function parseSecret(value: string, name: string): Buffer {
  const trimmed = value.trim()
  if (trimmed.length < 16) {
    throw new Error(`${name} must be at least 16 characters`)
  }
  return createHash('sha256').update(trimmed, 'utf8').digest()
}

function parseKey32(base64: string, name: string): Buffer {
  let buf: Buffer
  try {
    buf = Buffer.from(base64.trim(), 'base64')
  } catch {
    throw new Error(`${name} must be base64 encoded`)
  }
  if (buf.length !== 32) {
    throw new Error(`${name} must decode to exactly 32 bytes (got ${buf.length})`)
  }
  return buf
}

export function loadSecurityConfig(env: SecurityEnv = process.env as SecurityEnv): SecurityConfig {
  const pepperRaw = env.SESSION_PEPPER
  if (!pepperRaw) {
    throw new Error('SESSION_PEPPER is required')
  }
  const sessionPepper = parseSecret(pepperRaw, 'SESSION_PEPPER')
  const derivedKeys: string[] = []

  const pick = (explicit: string | undefined, label: string, name: string): Buffer => {
    if (explicit && explicit.trim().length > 0) {
      return parseSecret(explicit, name)
    }
    derivedKeys.push(name)
    return hkdf(sessionPepper, label)
  }

  const passwordMatchKey = pick(env.PASSWORD_MATCH_KEY, 'password-match', 'PASSWORD_MATCH_KEY')
  const abuseKey = pick(env.ABUSE_HMAC_KEY, 'abuse-pseudonym', 'ABUSE_HMAC_KEY')
  const logIpKey = pick(env.LOG_IP_HMAC_KEY, 'log-ip', 'LOG_IP_HMAC_KEY')
  const treeIdentityKey = pick(env.TREE_IDENTITY_HMAC_KEY, 'tree-identity', 'TREE_IDENTITY_HMAC_KEY')

  const currentVersion = Number.parseInt(env.DATA_ENCRYPTION_KEY_VERSION ?? '1', 10)
  if (!Number.isInteger(currentVersion) || currentVersion < 1) {
    throw new Error('DATA_ENCRYPTION_KEY_VERSION must be a positive integer')
  }
  const keys = new Map<number, Buffer>()
  if (env.DATA_ENCRYPTION_KEY) {
    keys.set(currentVersion, parseKey32(env.DATA_ENCRYPTION_KEY, 'DATA_ENCRYPTION_KEY'))
  } else {
    derivedKeys.push('DATA_ENCRYPTION_KEY')
    keys.set(currentVersion, hkdf(sessionPepper, `data-encryption-${currentVersion}`))
  }
  if (env.DATA_ENCRYPTION_KEY_PREVIOUS && currentVersion > 1) {
    keys.set(currentVersion - 1, parseKey32(env.DATA_ENCRYPTION_KEY_PREVIOUS, 'DATA_ENCRYPTION_KEY_PREVIOUS'))
  }

  return {
    sessionPepper,
    passwordMatchKey,
    abuseKey,
    logIpKey,
    treeIdentityKey,
    encryption: new Keyring(keys, currentVersion),
    derivedKeys,
  }
}
