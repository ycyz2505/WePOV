import { signal } from '@preact/signals'

function readPath(): string {
  return `${window.location.pathname}${window.location.search}`
}

export const routePath = signal<string>(readPath())

export interface NavigateOptions {
  replace?: boolean
}

export function navigate(to: string, options: NavigateOptions = {}): void {
  const current = readPath()
  if (to === current) return
  if (options.replace) {
    window.history.replaceState(null, '', to)
  } else {
    window.history.pushState(null, '', to)
  }
  routePath.value = readPath()
  window.scrollTo({ top: 0, left: 0 })
}

export function replaceQuery(params: Record<string, string | null>): void {
  const url = new URL(window.location.href)
  for (const [key, value] of Object.entries(params)) {
    if (value === null) url.searchParams.delete(key)
    else url.searchParams.set(key, value)
  }
  navigate(`${url.pathname}${url.search}`, { replace: true })
}

export function initRouter(): () => void {
  const onPopState = (): void => {
    routePath.value = readPath()
  }
  window.addEventListener('popstate', onPopState)
  return () => window.removeEventListener('popstate', onPopState)
}

export function parseLocation(path: string): { pathname: string; query: URLSearchParams } {
  const index = path.indexOf('?')
  if (index === -1) return { pathname: path, query: new URLSearchParams() }
  return { pathname: path.slice(0, index), query: new URLSearchParams(path.slice(index + 1)) }
}

export function segmentsOf(pathname: string): string[] {
  return pathname.split('/').filter((segment) => segment.length > 0)
}
