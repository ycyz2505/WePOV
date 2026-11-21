import type { FastifyPluginAsync } from 'fastify'
import { getPool } from '@wepov/database'
import { loadManifest } from '../lib/manifest.js'

/**
 * Health, readiness and app update manifest routes (design §17.4, §15.7).
 *
 * /health is dependency-free so the platform health check passes even when the
 * database or U3 are degraded. /ready reports both dependencies.
 */

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) }
  })

  app.get('/ready', async (_request, reply) => {
    let database: 'ok' | 'down' = 'ok'
    try {
      await getPool().query('SELECT 1')
    } catch {
      database = 'down'
    }
    let u3: 'ok' | 'down' | 'unconfigured' = 'unconfigured'
    if (app.u3.configured) {
      const ok = await app.u3.headBucket(app.u3.buckets.media)
      u3 = ok ? 'ok' : 'down'
    }
    const ready = database === 'ok' && u3 !== 'down'
    reply.status(ready ? 200 : 503)
    return { ready, database, u3 }
  })

  // App update manifest proxy, cached briefly (§15.7, §20.2).
  app.get('/api/v1/app/update-manifest', async (_request, reply) => {
    const manifest = await loadManifest(app)
    reply.header('Cache-Control', `public, max-age=${app.config.manifest.cacheSeconds}`)
    return manifest
  })
}
