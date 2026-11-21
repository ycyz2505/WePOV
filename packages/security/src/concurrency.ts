/**
 * A tiny counting semaphore used to cap concurrent expensive work.
 *
 * Two consumers:
 * - Argon2id hashing/verification (gate of 2, §4.4) so a burst of logins
 *   cannot exhaust memory/CPU on a 1.5 vCPU box.
 * - Global in-flight API requests (gate of 24 with a bounded 50ms wait queue,
 *   §15.3) implemented separately in inflight.ts.
 */

export interface Semaphore {
  /** Acquire a slot, waiting up to `maxWaitMs` (0 = wait forever). */
  acquire(maxWaitMs?: number): Promise<() => void>
  readonly active: number
  readonly waiting: number
}

export class CountingSemaphore implements Semaphore {
  readonly #limit: number
  #active = 0
  #queue: Array<{ resolve: (release: () => void) => void; timer?: NodeJS.Timeout }> = []

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Semaphore limit must be >= 1')
    this.#limit = limit
  }

  get active(): number {
    return this.#active
  }

  get waiting(): number {
    return this.#queue.length
  }

  acquire(maxWaitMs = 0): Promise<() => void> {
    if (this.#active < this.#limit) {
      this.#active += 1
      return Promise.resolve(this.#makeRelease())
    }
    return new Promise<() => void>((resolve, reject) => {
      const entry: { resolve: (release: () => void) => void; timer?: NodeJS.Timeout } = {
        resolve: (release) => {
          if (entry.timer) clearTimeout(entry.timer)
          resolve(release)
        },
      }
      if (maxWaitMs > 0) {
        entry.timer = setTimeout(() => {
          const idx = this.#queue.indexOf(entry)
          if (idx >= 0) this.#queue.splice(idx, 1)
          reject(new SemaphoreTimeoutError())
        }, maxWaitMs)
      }
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

export class SemaphoreTimeoutError extends Error {
  constructor() {
    super('Semaphore acquisition timed out')
    this.name = 'SemaphoreTimeoutError'
  }
}

/** Run `fn` while holding a slot from `sem`. */
export async function withSemaphore<T>(sem: Semaphore, fn: () => Promise<T>): Promise<T> {
  const release = await sem.acquire()
  try {
    return await fn()
  } finally {
    release()
  }
}
