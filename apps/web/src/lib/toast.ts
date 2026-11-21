import { signal } from '@preact/signals'

export interface ToastItem {
  id: number
  message: string
  tone: 'default' | 'error'
}

export const toasts = signal<ToastItem[]>([])

let counter = 0

export function showToast(message: string, tone: 'default' | 'error' = 'default'): void {
  const id = (counter += 1)
  toasts.value = [...toasts.value, { id, message, tone }].slice(-3)
  window.setTimeout(() => {
    toasts.value = toasts.value.filter((item) => item.id !== id)
  }, 3600)
}

export function dismissToast(id: number): void {
  toasts.value = toasts.value.filter((item) => item.id !== id)
}
