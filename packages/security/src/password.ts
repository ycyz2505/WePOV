import { hash as argonHash, verify as argonVerify, type Options } from '@node-rs/argon2'
import { hmacHex, safeEqualHex } from './hmac.js'
import { CountingSemaphore } from './concurrency.js'

/**
 * Password hashing and the "contained password" (防窥) login scheme (§4.4).
 *
 * Storage: Argon2id hash + password length + a server-keyed match tag.
 * Login: the user may surround the real password with noise. We slide a window
 * of `length` characters across the input, compute the HMAC match tag for each
 * candidate, and compare against the stored tag. Only the matching candidate is
 * verified with Argon2id — exactly one expensive hash per attempt.
 */

/**
 * Argon2id parameters fixed by the design: m=19 MiB, t=2, p=1.
 *
 * `algorithm: 2` is Argon2id. We intentionally do not reference the
 * `Algorithm` const enum: ambient const enums have no runtime value, so a value
 * import would break under transpile-only builders (tsx/esbuild).
 */
export const ARGON2_OPTIONS: Options = {
  algorithm: 2 as NonNullable<Options['algorithm']>,
  memoryCost: 19 * 1024, // KiB => 19 MiB
  timeCost: 2,
  parallelism: 1,
}

/** At most 2 concurrent Argon2 operations across the process. */
export const argonGate = new CountingSemaphore(2)

export interface PasswordRecord {
  hash: string
  length: number
  matchTag: string
}

const MATCH_TAG_BYTES = 16

/** Compute the server-keyed match tag for a known password. */
export function makeMatchTag(key: Buffer, password: string): string {
  return hmacHex(key, `pwtag:${password}`).slice(0, MATCH_TAG_BYTES * 2)
}

/** Hash a new password and derive its storage record. */
export async function hashPassword(key: Buffer, password: string): Promise<PasswordRecord> {
  if (password.length < 1 || password.length > 256) {
    throw new Error('Password length out of range')
  }
  const hash = await argonGate.acquire().then(async (release) => {
    try {
      return await argonHash(password, ARGON2_OPTIONS)
    } finally {
      release()
    }
  })
  return {
    hash,
    length: password.length,
    matchTag: makeMatchTag(key, password),
  }
}

/**
 * Locate the substring of `input` whose match tag equals `storedTag`.
 * Returns the candidate substring, or null when none matches.
 */
export function findContainedCandidate(
  key: Buffer,
  input: string,
  storedLength: number,
  storedTag: string,
): string | null {
  if (storedLength < 1 || storedLength > 256) return null
  if (input.length < storedLength) return null
  // Bound the work: inputs are capped at 256 chars by the schema, so this loop
  // is at most ~256 HMACs, far cheaper than a single Argon2 verify.
  const maxStart = input.length - storedLength
  for (let start = 0; start <= maxStart; start += 1) {
    const candidate = input.slice(start, start + storedLength)
    const tag = makeMatchTag(key, candidate)
    if (safeEqualHex(tag, storedTag)) {
      return candidate
    }
  }
  return null
}

export interface ContainedVerifyResult {
  ok: boolean
  /** True when a candidate matched the tag and an Argon2 verify ran. */
  candidateFound: boolean
}

/**
 * Verify a possibly-noisy password input. Runs at most one Argon2 verify.
 */
export async function verifyContainedPassword(
  key: Buffer,
  input: string,
  record: PasswordRecord,
): Promise<ContainedVerifyResult> {
  const candidate = findContainedCandidate(key, input, record.length, record.matchTag)
  if (candidate === null) {
    return { ok: false, candidateFound: false }
  }
  const ok = await argonGate.acquire().then(async (release) => {
    try {
      return await argonVerify(record.hash, candidate, ARGON2_OPTIONS)
    } catch {
      return false
    } finally {
      release()
    }
  })
  return { ok, candidateFound: true }
}

/** Verify an exact password (used when no match tag is available). */
export async function verifyExactPassword(hash: string, password: string): Promise<boolean> {
  return argonGate.acquire().then(async (release) => {
    try {
      return await argonVerify(hash, password, ARGON2_OPTIONS)
    } catch {
      return false
    } finally {
      release()
    }
  })
}
