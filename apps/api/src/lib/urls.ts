import type { FastifyInstance } from 'fastify'

/**
 * Object URLs. Media lives in a private U3 bucket, so every URL handed to the
 * client is a short-lived presigned GET. Nothing is public-by-URL.
 *
 * Presigns are cached in-process until shortly before they expire; a feed page
 * presigns the same avatar dozens of times and each call would otherwise cost
 * a signature computation.
 */

interface CacheEntry {
  url: string
  expiresAt: number
}

const CACHE_LIMIT = 5000
const cache = new Map<string, CacheEntry>()

function cacheGet(key: string): string | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key)
    return null
  }
  return entry.url
}

function cacheSet(key: string, url: string, expiresInSeconds: number): void {
  if (cache.size >= CACHE_LIMIT) {
    // Map iteration is insertion-ordered, so the first key is the oldest.
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }
  cache.set(key, { url, expiresAt: Date.now() + Math.max(30, expiresInSeconds - 60) * 1000 })
}

export async function objectUrl(
  app: FastifyInstance,
  key: string | null | undefined,
  options: { downloadFilename?: string | null } = {},
): Promise<string | null> {
  if (!key) return null
  if (!app.u3.configured) return null
  const expires = app.config.u3.presignExpirySeconds
  const filename = options.downloadFilename ?? null
  const cacheKey = `${filename ? 'dl' : 'get'}:${key}`
  const hit = cacheGet(cacheKey)
  if (hit) return hit
  try {
    const url = await app.u3.presignGet({
      bucket: app.u3.buckets.media,
      key,
      expiresSeconds: expires,
      ...(filename
        ? { responseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(filename)}` }
        : {}),
    })
    cacheSet(cacheKey, url, expires)
    return url
  } catch {
    return null
  }
}

export function avatarUrl(app: FastifyInstance, key: string | null | undefined): Promise<string | null> {
  return objectUrl(app, key)
}

export interface MediaUrlSet {
  thumbnailUrl: string | null
  previewUrl: string | null
  downloadUrl: string | null
}

/**
 * The client never transcodes on the server, so all three URLs point at the
 * stored original. Keeping three fields lets the UI evolve (and lets a future
 * variant bucket fill `thumbnailUrl` from `media_variants`) without a contract
 * change.
 */
export async function mediaUrls(
  app: FastifyInstance,
  key: string | null | undefined,
  filename?: string | null,
): Promise<MediaUrlSet> {
  if (!key) return { thumbnailUrl: null, previewUrl: null, downloadUrl: null }
  const [plain, download] = await Promise.all([
    objectUrl(app, key),
    objectUrl(app, key, { downloadFilename: filename ?? null }),
  ])
  return { thumbnailUrl: plain, previewUrl: plain, downloadUrl: download }
}

export function clearUrlCache(): void {
  cache.clear()
}
