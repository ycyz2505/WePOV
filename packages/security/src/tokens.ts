import { createHash, randomBytes } from 'node:crypto'
import { hmacHex } from './hmac.js'

/**
 * Opaque session tokens, hashed at rest (§4.5, §4.6).
 *
 * Tokens are random 256-bit values (base64url). We store HMAC(pepper, token)
 * so a database dump alone cannot forge a session. The pepper comes from the
 * security config; a per-purpose prefix keeps access/refresh hashes distinct.
 */

const TOKEN_BYTES = 32

export interface IssuedToken {
  /** Raw token to hand to the client. Never stored. */
  token: string
  /** Hash to persist. */
  hash: string
}

export function newOpaqueToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

export function hashToken(pepper: Buffer, kind: 'access' | 'refresh' | 'gateway' | 'recovery', token: string): string {
  return hmacHex(pepper, `tok:${kind}:${token}`)
}

export function issueToken(
  pepper: Buffer,
  kind: 'access' | 'refresh' | 'gateway' | 'recovery',
): IssuedToken {
  const token = newOpaqueToken()
  return { token, hash: hashToken(pepper, kind, token) }
}

/** SHA-256 hex of arbitrary bytes; used for upload validation, not secrets. */
export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Hash the shared class gateway passcode (§4.1). It is a shared barrier, not a
 * per-user credential, so a peppered SHA-256 is sufficient (no Argon2 needed).
 * The version segment lets rotation invalidate every outstanding admission.
 */
export function hashGatewayPasscode(pepper: string, version: number, passcode: string): string {
  return createHash('sha256').update(`${pepper}:gateway:${version}:${passcode}`, 'utf8').digest('hex')
}

/** Generate a human-typable recovery code, e.g. WEPO-7F3K-2Q9M. */
export function newRecoveryCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const groups: string[] = []
  for (let g = 0; g < 3; g += 1) {
    let group = ''
    for (let i = 0; i < 4; i += 1) {
      group += alphabet[randomBytes(1)[0]! % alphabet.length]
    }
    groups.push(group)
  }
  return groups.join('-')
}

/** Generate a 10-char initial password for roster import (§4.3). */
export function newInitialPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let out = ''
  const bytes = randomBytes(10)
  for (let i = 0; i < 10; i += 1) {
    out += alphabet[bytes[i]! % alphabet.length]
  }
  return out
}
