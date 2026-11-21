import type { JSX } from 'preact'
import { dismissToast, toasts } from '../lib/toast'
import { Icon } from './Icon'
import ui from './ui.module.css'

export function ToastHost(): JSX.Element | null {
  if (toasts.value.length === 0) return null
  return (
    <div aria-live="polite" aria-atomic="false">
      {toasts.value.map((toast) => (
        <div
          key={toast.id}
          class={[ui.toast, toast.tone === 'error' ? ui.toastError : ''].filter(Boolean).join(' ')}
          role={toast.tone === 'error' ? 'alert' : 'status'}
        >
          <Icon name={toast.tone === 'error' ? 'alert' : 'info'} size={16} />
          <span>{toast.message}</span>
          <button
            type="button"
            onClick={() => dismissToast(toast.id)}
            aria-label="关闭提示"
            style={{ color: 'inherit', opacity: 0.7, marginLeft: 4 }}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
