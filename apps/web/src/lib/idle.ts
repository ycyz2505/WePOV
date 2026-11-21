import { effect } from '@preact/signals'
import { currentUser, idleTimeoutMinutes, logout, logoutOnUnload, sessionMode } from './session'

const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = [
  'pointerdown',
  'keydown',
  'wheel',
  'touchstart',
  'mousemove',
]

export class IdleTimer {
  private lastActivity = Date.now()
  private timer: number | null = null
  private running = false
  private readonly activityHandler = (): void => {
    this.lastActivity = Date.now()
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.lastActivity = Date.now()
    for (const eventName of ACTIVITY_EVENTS) {
      window.addEventListener(eventName, this.activityHandler, { passive: true })
    }
    this.schedule()
  }

  stop(): void {
    this.running = false
    for (const eventName of ACTIVITY_EVENTS) {
      window.removeEventListener(eventName, this.activityHandler)
    }
    if (this.timer !== null) {
      window.clearInterval(this.timer)
      this.timer = null
    }
  }

  private schedule(): void {
    if (this.timer !== null) window.clearInterval(this.timer)
    this.timer = window.setInterval(() => {
      const limitMs = idleTimeoutMinutes.value * 60_000
      if (Date.now() - this.lastActivity >= limitMs) {
        void logout()
      }
    }, 5_000)
  }

  private refreshSchedule(): void {
    if (this.running) this.schedule()
  }

  registerScheduleRefresh(): void {
    effect(() => {
      // re-arm interval when timeout changes
      void idleTimeoutMinutes.value
      this.refreshSchedule()
    })
  }
}

export const idleTimer = new IdleTimer()

export function installUnloadHandlers(): void {
  const handler = (): void => logoutOnUnload()
  window.addEventListener('pagehide', handler)
  window.addEventListener('beforeunload', handler)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && sessionMode.value === 'temporary') {
      // temporary sessions should not linger when the tab is backgrounded on shared screens
      // but do not force logout to avoid losing work; token still dies on close
    }
  })
}

export function initSessionLifecycle(): () => void {
  idleTimer.registerScheduleRefresh()
  const startEffect = effect(() => {
    if (currentUser.value) {
      idleTimer.start()
    } else {
      idleTimer.stop()
    }
  })
  installUnloadHandlers()
  return () => {
    startEffect()
    idleTimer.stop()
  }
}
