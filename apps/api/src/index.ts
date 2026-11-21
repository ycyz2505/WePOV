import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import cookie from '@fastify/cookie'
import {
  InflightGate,
  LoginFailureTracker,
  RateLimiter,
  SessionManager,
} from '@wepov/security'
import { closePool } from '@wepov/database'
import { loadConfig } from './config.js'
import { U3Client } from './lib/u3.js'
import { PgLoginFailureStore, PgSessionStore } from './lib/session-store.js'
import { NotificationBus } from './lib/notification-bus.js'
import { requestContextPlugin } from './plugins/request-context.js'
import { rateLimitPlugin } from './plugins/rate-limit.js'
import { gatewayPlugin } from './plugins/gateway.js'
import { authPlugin } from './plugins/auth.js'
import { versionGatePlugin } from './plugins/version-gate.js'
import { registerErrorHandler } from './plugins/error-handler.js'
import { healthRoutes } from './routes/health.js'
import { gatewayRoutes } from './routes/gateway.js'
import { authRoutes } from './routes/auth.js'
import { sessionRoutes } from './routes/sessions.js'
import { profileRoutes } from './routes/profiles.js'
import { followRoutes } from './routes/follows.js'
import { treeRoutes } from './routes/tree.js'
import { partnerRoutes } from './routes/partners.js'
import { albumRoutes } from './routes/albums.js'
import { uploadRoutes } from './routes/uploads.js'
import { capsuleRoutes } from './routes/capsules.js'
import { classroomRoutes } from './routes/classroom.js'
import { bossRoutes } from './routes/boss.js'
import { notificationRoutes } from './routes/notifications.js'
import { eventsRoutes } from './routes/events.js'import { reportRoutes } from './routes/reports.js'
import { adminRoutes } from './routes/admin.js'

/**
 * 第一人称 / WePOV API + web host.
 *
 * One process serves the JSON API and the built Preact app. Ordering of hooks
 * is deliberate: request id and headers → version gate → rate limit and the
 * in-flight gate (before any DB work) → class gateway (DB) → auth resolution.
 */

const WEB_ROOT = fileURLToPath(new URL('../../web/dist', import.meta.url))

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

const HTML_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
].join('; ')

function buildApp(): FastifyInstance {
  const config = loadConfig()

  const app = Fastify({
    logger: { level: config.logLevel },
    bodyLimit: config.bodyLimitBytes,
    trustProxy: config.trustedProxyHops > 0,
    disableRequestLogging: true,
  })

  app.decorate('config', config)
  app.decorate('u3', new U3Client(config.u3))
  app.decorate('sessions', new SessionManager(new PgSessionStore(), config.security.sessionPepper))
  app.decorate('rateLimiter', new RateLimiter())
  app.decorate('inflight', new InflightGate())
  app.decorate('loginFailures', new LoginFailureTracker(new PgLoginFailureStore()))
  app.decorate('notifications', new NotificationBus())

  registerErrorHandler(app)

  return app
}

function sendFile(reply: FastifyReply, filePath: string, cacheControl: string): FastifyReply {
  const ext = path.extname(filePath).toLowerCase()
  reply.header('Content-Type', MIME[ext] ?? 'application/octet-stream')
  reply.header('Cache-Control', cacheControl)
  reply.header('X-Content-Type-Options', 'nosniff')
  if (ext === '.html' || ext === '.js' || ext === '.css' || ext === '.webmanifest') {
    reply.header('Content-Security-Policy', HTML_CSP)
  }
  return reply.send(createReadStream(filePath))
}

async function serveStatic(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const raw = (request.params as { '*': string })['*'] ?? ''
  let relative: string
  try {
    relative = decodeURIComponent(raw)
  } catch {
    reply.status(400).send({ code: 'bad_path', message: '路径不合法' })
    return
  }

  const resolved = path.resolve(WEB_ROOT, `.${path.sep}${relative}`)
  if (resolved !== WEB_ROOT && !resolved.startsWith(WEB_ROOT + path.sep)) {
    reply.status(404).send({ code: 'not_found', message: '资源不存在' })
    return
  }

  // Hashed build output never changes; everything else revalidates.
  const immutable = relative.startsWith('assets/')
  const cacheControl = immutable ? 'public, max-age=31536000, immutable' : 'no-cache'

  try {
    const info = await stat(resolved)
    if (info.isFile()) {
      await sendFile(reply, resolved, cacheControl)
      return
    }
  } catch {
    // fall through
  }

  // Unknown path with an extension is a real 404; a route path is the SPA.
  if (path.extname(relative).length > 0) {
    reply.status(404).send({ code: 'not_found', message: '资源不存在' })
    return
  }

  try {
    await stat(path.join(WEB_ROOT, 'index.html'))
  } catch {
    reply
      .status(503)
      .type('text/plain; charset=utf-8')
      .send('前端尚未构建。请在仓库根目录运行 npm run build。')
    return
  }
  await sendFile(reply, path.join(WEB_ROOT, 'index.html'), 'no-cache')
}

async function main(): Promise<void> {
  const app = buildApp()

  await app.register(cookie)

  await app.register(requestContextPlugin)
  await app.register(versionGatePlugin)
  await app.register(rateLimitPlugin)
  await app.register(gatewayPlugin)
  await app.register(authPlugin)

  await app.register(healthRoutes)
  await app.register(gatewayRoutes)
  await app.register(authRoutes)
  await app.register(sessionRoutes)
  await app.register(profileRoutes)
  await app.register(followRoutes)
  await app.register(treeRoutes)
  await app.register(partnerRoutes)
  await app.register(albumRoutes)
  await app.register(uploadRoutes)
  await app.register(capsuleRoutes)
  await app.register(classroomRoutes)
  await app.register(bossRoutes)
  await app.register(notificationRoutes)
  await app.register(eventsRoutes)
  await app.register(reportRoutes)
  await app.register(adminRoutes)

  // Fastify exposes HEAD automatically for every GET route.
  app.get('/*', serveStatic)

  const config = app.config
  if (config.security.derivedKeys.length > 0 && config.isProduction) {
    app.log.warn(
      { derivedKeys: config.security.derivedKeys },
      '部分密钥由 SESSION_PEPPER 派生；生产环境建议分别提供独立密钥',
    )
  }

  await app.listen({ port: config.port, host: config.host })
  app.log.info({ port: config.port, env: config.nodeEnv }, 'WePOV 已启动')

  let closing = false
  const shutdown = (signal: string): void => {
    if (closing) return
    closing = true
    app.log.info({ signal }, '正在关闭')
    void app
      .close()
      .catch(() => undefined)
      .then(() => closePool())
      .finally(() => process.exit(0))
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      level: 'fatal',
      msg: 'startup_failed',
      error: error instanceof Error ? error.message : String(error),
    }),
  )
  process.exit(1)
})
