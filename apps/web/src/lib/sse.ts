import type { Notification } from './types'
import { pushLiveNotification, registerUnauthorized } from './session'
import { API_BASE } from './api'

export type SseStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'

type StatusListener = (status: SseStatus) => void
type NotificationListener = (notification: Notification) => void

interface SseMessage {
  event: string
  data: string
  id: string | null
}

export class NotificationStream {
  private source: EventSource | null = null
  private status: SseStatus = 'idle'
  private readonly statusListeners = new Set<StatusListener>()
  private readonly notificationListeners = new Set<NotificationListener>()
  private lastEventId: string | null = null
  private reconnectTimer: number | null = null
  private reconnectAttempt = 0
  private stopped = false

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener)
    listener(this.status)
    return () => this.statusListeners.delete(listener)
  }

  onNotification(listener: NotificationListener): () => void {
    this.notificationListeners.add(listener)
    return () => this.notificationListeners.delete(listener)
  }

  getStatus(): SseStatus {
    return this.status
  }

  connect(): void {
    this.stopped = false
    if (this.source) return
    this.open()
  }

  private setStatus(next: SseStatus): void {
    if (this.status === next) return
    this.status = next
    for (const listener of this.statusListeners) listener(next)
  }

  private open(): void {
    this.setStatus(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting')
    const url = new URL(`${API_BASE}/events`, window.location.origin)
    if (this.lastEventId) url.searchParams.set('cursor', this.lastEventId)
    const source = new EventSource(url.pathname + url.search, { withCredentials: true })
    this.source = source

    source.onopen = () => {
      this.reconnectAttempt = 0
      this.setStatus('open')
    }

    source.onerror = () => {
      source.close()
      this.source = null
      if (this.stopped) {
        this.setStatus('closed')
        return
      }
      this.scheduleReconnect()
    }

    source.addEventListener('notification', (event) => {
      this.handle(event as MessageEvent<string>)
    })
    source.addEventListener('message', (event) => {
      this.handle(event as MessageEvent<string>)
    })
  }

  private handle(event: MessageEvent<string>): void {
    if (event.lastEventId) this.lastEventId = event.lastEventId
    let parsed: SseMessage
    try {
      parsed = {
        event: event.type,
        data: event.data,
        id: event.lastEventId || null,
      }
    } catch {
      return
    }
    if (parsed.event !== 'notification' && parsed.event !== 'message') return
    try {
      const notification = JSON.parse(parsed.data) as Notification
      pushLiveNotification(notification)
      for (const listener of this.notificationListeners) listener(notification)
    } catch {
      // ignore malformed payloads
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return
    this.reconnectAttempt += 1
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnectAttempt, 5))
    this.setStatus('reconnecting')
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      if (!this.stopped) this.open()
    }, delay)
  }

  disconnect(): void {
    this.stopped = true
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.source?.close()
    this.source = null
    this.setStatus('closed')
  }
}

export const notificationStream = new NotificationStream()

registerUnauthorized(() => notificationStream.disconnect())
