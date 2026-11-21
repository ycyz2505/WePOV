/**
 * Global in-flight request gate (§15.3).
 *
 * - At most 24 concurrent API requests.
 * - A bounded wait queue of 16 with a 50ms max wait.
 * - Anything beyond fast-fails with 503 + Retry-After rather than piling up.
 */

export interface InflightOptions {
  maxConcurrent?: number
  queueSize?: number
  maxWaitMs?: number
}

export type InflightResult =
  | { ok: true; release: () => void }
  | { ok: false; reason: 'queue_full' | 'timeout'; retryAfterMs: number }

export class InflightGate {
  readonly #maxConcurrent: number
  readonly #queueSize: number
  readonly #maxWaitMs: number
  #active = 0
  #queue: Array<{ resolve: (release: () => void) => void; timer: NodeJS.Timeout }> = []

  constructor(options: InflightOptions = {}) {
    this.#maxConcurrent = options.maxConcurrent ?? 24
    this.#queueSize = options.queueSize ?? 16
    this.#maxWaitMs = options.maxWaitMs ?? 50
  }

  get active(): number {
    return this.#active
  }

  get waiting(): number {
    return this.#queue.length
  }

  /** Try to enter; never waits longer than maxWaitMs. */
  tryEnter(): Promise<InflightResult> {
    if (this.#active < this.#maxConcurrent) {
      this.#active += 1
      return Promise.resolve({ ok: true, release: this.#makeRelease() })
    }
    if (this.#queue.length >= this.#queueSize) {
      return Promise.resolve({ ok: false, reason: 'queue_full', retryAfterMs: 200 })
    }
    return new Promise<InflightResult>((resolve) => {
      const entry: { resolve: (release: () => void) => void; timer: NodeJS.Timeout } = {
        resolve: (release) => {
          clearTimeout(entry.timer)
          resolve({ ok: true, release })
        },
        timer: setTimeout(() => {
          const idx = this.#queue.indexOf(entry)
          if (idx >= 0) this.#queue.splice(idx, 1)
          resolve({ ok: false, reason: 'timeout', retryAfterMs: 100 })
        }, this.#maxWaitMs),
      }
      entry.timer.unref?.()
      this.#queue.push(entry)
    })
  }

  #makeRelease(): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      this.#active -= 1
      const next = this.#queue.shift()
      if (next) {
        this.#active += 1
        next.resolve(this.#makeRelease())
      }
    }
  }
}
