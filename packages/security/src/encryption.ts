import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * AES-256-GCM with a per-row random 96-bit nonce and an explicit key version.
 *
 * Used for tree-hole author identity and sealed capsule bodies (§6.2, §9.2).
 * AAD binds the ciphertext to its purpose and row so a blob cannot be moved to
 * a different column or record.
 */

export interface SealedValue {
  /** base64 ciphertext */
  ct: string
  /** base64 12-byte nonce */
  iv: string
  /** base64 16-byte auth tag */
  tag: string
  /** key version used */
  v: number
}

const NONCE_BYTES = 12
const TAG_BYTES = 16

export class Keyring {
  readonly #keys: Map<number, Buffer>
  readonly #current: number

  constructor(keys: Map<number, Buffer>, currentVersion: number) {
    if (keys.size === 0) throw new Error('Keyring requires at least one key')
    for (const [version, key] of keys) {
      if (!Number.isInteger(version) || version < 1) throw new Error(`Invalid key version ${version}`)
      if (key.length !== 32) throw new Error(`Key version ${version} must be 32 bytes`)
    }
    if (!keys.has(currentVersion)) throw new Error('Current key version has no key')
    this.#keys = new Map(keys)
    this.#current = currentVersion
  }

  get currentVersion(): number {
    return this.#current
  }

  has(version: number): boolean {
    return this.#keys.has(version)
  }

  seal(plaintext: string | Buffer, aad: string): SealedValue {
    const key = this.#keys.get(this.#current)
    if (!key) throw new Error('Current key missing')
    const iv = randomBytes(NONCE_BYTES)
    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES })
    cipher.setAAD(Buffer.from(aad, 'utf8'))
    const input = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext
    const ct = Buffer.concat([cipher.update(input), cipher.final()])
    const tag = cipher.getAuthTag()
    return {
      ct: ct.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      v: this.#current,
    }
  }

  open(sealed: SealedValue, aad: string): Buffer {
    const key = this.#keys.get(sealed.v)
    if (!key) throw new Error(`No key for version ${sealed.v}`)
    const iv = Buffer.from(sealed.iv, 'base64')
    const tag = Buffer.from(sealed.tag, 'base64')
    const ct = Buffer.from(sealed.ct, 'base64')
    if (iv.length !== NONCE_BYTES) throw new Error('Invalid nonce length')
    if (tag.length !== TAG_BYTES) throw new Error('Invalid tag length')
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES })
    decipher.setAAD(Buffer.from(aad, 'utf8'))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ct), decipher.final()])
  }

  openString(sealed: SealedValue, aad: string): string {
    return this.open(sealed, aad).toString('utf8')
  }
}

export function isSealedValue(value: unknown): value is SealedValue {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v['ct'] === 'string' &&
    typeof v['iv'] === 'string' &&
    typeof v['tag'] === 'string' &&
    typeof v['v'] === 'number'
  )
}
