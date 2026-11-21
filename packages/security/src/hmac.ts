import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * HMAC helpers. Two families:
 *
 * - Pseudonyms (`hmacHex`) for irreversible internal identifiers: abuse
 *   rate-limit/ban keys and log IP correlation. A separate key per purpose is
 *   supplied by the config so an identifier from one domain is useless in
 *   another (§6.2, §14.2).
 * - The password match tag (§4.4), see password.ts.
 */

export function hmacHex(key: Buffer, message: string): string {
  return createHmac('sha256', key).update(message, 'utf8').digest('hex')
}

export function hmacBuffer(key: Buffer, message: string | Buffer): Buffer {
  return createHmac('sha256', key).update(message).digest()
}

/** Constant-time comparison of two hex strings of equal length. */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const ba = Buffer.from(a, 'hex')
  const bb = Buffer.from(b, 'hex')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

export function safeEqualString(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}
