import { EventEmitter } from 'node:events'

/**
 * In-process notification bus powering SSE (§12).
 *
 * Subscribers are keyed by user id. Each notification published here carries a
 * monotonic cursor (the DB `seq`); the SSE endpoint also supports catch-up via
 * `Last-Event-ID` / `cursor` so a reconnect never misses notifications.
 */

export interface BusNotification {
  id: string
  seq: string
  kind: string
  title: string
  body: string
  href: string | null
  readAt: string | null
  createdAt: string
}

export class NotificationBus {
  readonly #emitter = new EventEmitter()

  constructor() {
    // Many users can subscribe; avoid the default 10-listener warning.
    this.#emitter.setMaxListeners(0)
  }

  #channel(userId: string): string {
    return `user:${userId}`
  }

  subscribe(userId: string, listener: (notification: BusNotification) => void): () => void {
    const channel = this.#channel(userId)
    this.#emitter.on(channel, listener)
    return () => this.#emitter.off(channel, listener)
  }

  publish(userId: string, notification: BusNotification): void {
    this.#emitter.emit(this.#channel(userId), notification)
  }

  subscriberCount(userId: string): number {
    return this.#emitter.listenerCount(this.#channel(userId))
  }
}
