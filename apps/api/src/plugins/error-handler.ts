import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import { ApiError, type ApiErrorBody } from '../errors.js'

/**
 * Central error handler (§19). Produces the unified error body and sets
 * Retry-After for 429/503. Unknown errors become a generic 500 without leaking
 * internals.
 */

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | ApiError | ZodError, request: FastifyRequest, reply: FastifyReply) => {
    const requestId = (request as FastifyRequest & { requestId?: string }).requestId ?? 'unknown'

    if (error instanceof ApiError) {
      if (error.retryAfterSeconds !== null) {
        reply.header('Retry-After', String(error.retryAfterSeconds))
      }
      const body: ApiErrorBody = {
        code: error.code,
        message: error.message,
        requestId,
      }
      // 426 returns the manifest/policy directly as the body.
      if (error.statusCode === 426) {
        reply.status(426).send(error.details ?? body)
        return
      }
      if (error.details !== undefined) body.details = error.details
      reply.status(error.statusCode).send(body)
      return
    }

    if (error instanceof ZodError) {
      reply.status(400).send({
        code: 'validation_error',
        message: '请求参数不合法',
        requestId,
        details: error.issues,
      } satisfies ApiErrorBody)
      return
    }

    const fastifyError = error as FastifyError
    // Body too large and malformed JSON are client errors.
    if (fastifyError.statusCode === 413) {
      reply.status(413).send({ code: 'payload_too_large', message: '请求体过大', requestId } satisfies ApiErrorBody)
      return
    }
    if (fastifyError.statusCode === 400 && fastifyError.code === 'FST_ERR_CTP_INVALID_JSON_BODY') {
      reply.status(400).send({ code: 'invalid_json', message: '请求体不是合法 JSON', requestId } satisfies ApiErrorBody)
      return
    }
    if (fastifyError.statusCode === 429) {
      reply.header('Retry-After', '1')
      reply.status(429).send({ code: 'rate_limited', message: '请求过于频繁', requestId } satisfies ApiErrorBody)
      return
    }

    request.log.error({ err: fastifyError, requestId }, 'unhandled_error')
    reply.status(500).send({
      code: 'internal_error',
      message: '服务器内部错误',
      requestId,
    } satisfies ApiErrorBody)
  })

  app.setNotFoundHandler((request, reply) => {
    const requestId = (request as FastifyRequest & { requestId?: string }).requestId ?? 'unknown'
    reply.status(404).send({ code: 'not_found', message: '资源不存在', requestId } satisfies ApiErrorBody)
  })
}
