/**
 * Unified error model (§19): every error response is
 *   { code, message, requestId, details? }
 *
 * 429/503 responses must carry a Retry-After header. 426 responses return the
 * AppVersionPolicy body directly (§15.7).
 */

export interface ApiErrorBody {
  code: string
  message: string
  requestId: string
  details?: unknown
}

export class ApiError extends Error {
  readonly statusCode: number
  readonly code: string
  readonly details: unknown
  readonly retryAfterSeconds: number | null

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options: { details?: unknown; retryAfterSeconds?: number | null } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.code = code
    this.details = options.details
    this.retryAfterSeconds = options.retryAfterSeconds ?? null
  }

  static badRequest(code: string, message: string, details?: unknown): ApiError {
    return new ApiError(400, code, message, { details })
  }
  static unauthorized(code = 'unauthorized', message = '需要登录'): ApiError {
    return new ApiError(401, code, message)
  }
  static forbidden(code = 'forbidden', message = '无权访问'): ApiError {
    return new ApiError(403, code, message)
  }
  static notFound(code = 'not_found', message = '资源不存在'): ApiError {
    return new ApiError(404, code, message)
  }
  static conflict(code: string, message: string, details?: unknown): ApiError {
    return new ApiError(409, code, message, { details })
  }
  static tooManyRequests(message: string, retryAfterSeconds: number, code = 'rate_limited'): ApiError {
    return new ApiError(429, code, message, { retryAfterSeconds })
  }
  static serviceUnavailable(message: string, retryAfterSeconds: number, code = 'unavailable'): ApiError {
    return new ApiError(503, code, message, { retryAfterSeconds })
  }
  static upgradeRequired(message: string, policy: unknown): ApiError {
    return new ApiError(426, 'app_version_unsupported', message, { details: policy })
  }
}

/** Map a zod error to a 400 with field details. */
export function validationError(issues: unknown): ApiError {
  return new ApiError(400, 'validation_error', '请求参数不合法', { details: issues })
}
