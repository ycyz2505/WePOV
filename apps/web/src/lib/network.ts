import { signal } from '@preact/signals'

export const online = signal<boolean>(typeof navigator === 'undefined' ? true : navigator.onLine)
export const serverReachable = signal<boolean>(true)

export function initNetworkWatch(): () => void {
  const onOnline = (): void => {
    online.value = true
  }
  const onOffline = (): void => {
    online.value = false
  }
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  return () => {
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
  }
}

export function markServerReachable(reachable: boolean): void {
  serverReachable.value = reachable
}
