import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { ApiError, NetworkError } from './api'

export type AsyncState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: Error }

export interface AsyncResult<T> {
  state: AsyncState<T>
  reload: () => void
  setData: (updater: (current: T) => T) => void
}

export function useAsync<T>(
  loader: () => Promise<T>,
  deps: ReadonlyArray<unknown>,
  options: { skip?: boolean } = {},
): AsyncResult<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: 'idle' })
  const [nonce, setNonce] = useState(0)
  const mounted = useRef(true)
  const loaderRef = useRef(loader)
  loaderRef.current = loader

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (options.skip) {
      setState({ status: 'idle' })
      return
    }
    let cancelled = false
    setState({ status: 'loading' })
    loaderRef
      .current()
      .then((data) => {
        if (!cancelled && mounted.current) setState({ status: 'success', data })
      })
      .catch((error: unknown) => {
        if (!cancelled && mounted.current) {
          setState({ status: 'error', error: normalizeError(error) })
        }
      })
    return () => {
      cancelled = true
    }
  }, [...deps, nonce, options.skip])

  const reload = useCallback(() => setNonce((value) => value + 1), [])
  const setData = useCallback((updater: (current: T) => T) => {
    setState((current) =>
      current.status === 'success' ? { status: 'success', data: updater(current.data) } : current,
    )
  }, [])

  return { state, reload, setData }
}

export function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error
  return new Error('未知错误')
}

export function describeError(error: Error): { title: string; detail: string; retryable: boolean } {
  if (error instanceof NetworkError) {
    return {
      title: '网络不可用',
      detail: '请检查网络连接后重试。如果连接正常，可能是服务暂时不可达。',
      retryable: true,
    }
  }
  if (error instanceof ApiError) {
    if (error.status === 429) {
      return {
        title: '请求太频繁',
        detail:
          error.retryAfterSeconds !== null
            ? `请 ${error.retryAfterSeconds} 秒后再试。`
            : '操作过快，请稍等片刻再试。',
        retryable: true,
      }
    }
    if (error.status === 503) {
      return {
        title: '服务暂时不可用',
        detail:
          error.retryAfterSeconds !== null
            ? `系统繁忙，约 ${error.retryAfterSeconds} 秒后自动恢复，请稍后重试。`
            : '系统繁忙，请稍后重试。',
        retryable: true,
      }
    }
    if (error.status === 403) {
      return { title: '没有权限', detail: error.message || '你没有执行此操作的权限。', retryable: false }
    }
    if (error.status === 404) {
      return { title: '内容不存在', detail: '它可能已被删除或你访问的链接有误。', retryable: false }
    }
    if (error.status === 409) {
      return { title: '操作冲突', detail: error.message || '数据已被其他人修改，请刷新后再试。', retryable: true }
    }
    return {
      title: '操作没有完成',
      detail: error.message || '请稍后重试。',
      retryable: error.status >= 500,
    }
  }
  return { title: '操作没有完成', detail: error.message || '请稍后重试。', retryable: true }
}
