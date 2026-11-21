import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ApiError } from '../errors.js'
import { loadManifest } from '../lib/manifest.js'
import { loadVersionPolicy } from '../lib/policy.js'

/**
 * App version gate (§15.7).
 *
 * Blocking rule (coordinator contract):
 * - Only when the request carries `X-App-Version` AND its versionCode is below
 *   the server's `minSupportedVersionCode`.
 * - A missing header (web clients) NEVER blocks.
 *
 * On block we return 426 with the update-manifest as the body (the client's
 * VersionGateError reads `policy` straight from the body).
 */

const SKIP_PREFIXES = ['/health', '/ready', '/api/v1/app/update-manifest']

export async function versionGatePlugin(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (request: FastifyRequest, _reply: FastifyReply) => {
    const url = request.url
    if (SKIP_PREFIXES.some((prefix) => url.startsWith(prefix))) return

    const raw = request.headers['x-app-version']
    if (typeof raw !== 'string' || raw.length === 0) return
    const versionCode = Number.parseInt(raw, 10)
    if (!Number.isFinite(versionCode)) return

    const policy = await loadVersionPolicy(app)
    if (policy.minSupportedVersionCode <= 0) return
    if (versionCode >= policy.minSupportedVersionCode) return

    const manifest = await loadManifest(app)
    throw ApiError.upgradeRequired('当前版本过低，需要更新后才能继续使用', manifest)
  })
}
