/**
 * Publication scheduler: paces streaming repaints at a bounded frame rate
 * while publishing structural events immediately — the design the official-
 * terminal-application Agent Note's "Rendering" section requires ("A
 * publication scheduler paces stream repaints (default 30 FPS as a validated
 * Config field) while structural events publish immediately").
 *
 * `render.ts` calls {@link PublicationScheduler.schedule} with `'stream'` for
 * a token delta or spinner tick, and `'structural'` for an event a user must
 * see without delay: a closed step's scrollback commit, a turn ending, or an
 * approval/question appearing or resolving. A `'stream'` call coalesces into
 * at most one publish per frame interval; a `'structural'` call publishes at
 * once and cancels any pending coalesced timer, so the next `'stream'` call
 * starts a fresh interval rather than double-publishing moments later.
 * @module @deepseek-ai/dsh-tui-ink-ui/scheduler/publication-scheduler
 */

import type { ResolvedRendererConfig } from '../config.ts'

/** Reason a repaint was requested; see the module doc for how each is handled. */
export type PublicationReason = 'stream' | 'structural'

/**
 * Injectable timer/clock seam, so scheduling logic is testable without real
 * wall-clock delay. Defaults to the real `setTimeout`/`clearTimeout`/`Date.now`.
 */
export interface PublicationSchedulerClock {
  /** Same contract as `globalThis.setTimeout`: schedule `handler` after `ms`. */
  setTimeout(handler: () => void, ms: number): unknown
  /** Same contract as `globalThis.clearTimeout`. */
  clearTimeout(handle: unknown): void
  /** Same contract as `Date.now()`. */
  now(): number
}

const REAL_CLOCK: PublicationSchedulerClock = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) => { clearTimeout(handle as ReturnType<typeof setTimeout>) },
  now: () => Date.now(),
}

/** A live scheduler instance. */
export interface PublicationScheduler {
  /**
   * Request a repaint. `'stream'` coalesces to at most one publish per frame
   * interval; `'structural'` publishes immediately.
   * @param reason - why a repaint was requested.
   */
  schedule(reason: PublicationReason): void
  /** Cancel any pending coalesced publish and stop accepting further requests. */
  dispose(): void
}

/**
 * Create a publication scheduler bound to one `publish` callback.
 * @param publish - invoked (synchronously, from `schedule()` or a timer) each time a repaint is due.
 * @param config - resolved renderer config; `publishRateFps` sets the frame interval.
 * @param clock - timer/clock seam (real timers by default; tests inject a fake one).
 * @returns the scheduler.
 */
export function createPublicationScheduler(
  publish: () => void,
  config: ResolvedRendererConfig,
  clock: PublicationSchedulerClock = REAL_CLOCK,
): PublicationScheduler {
  const frameIntervalMs = Math.ceil(1000 / config.publishRateFps)
  let pendingTimer: unknown
  // Baselined at construction time, not `-Infinity`: `render.ts` always
  // paints once synchronously before any subscription-driven update can
  // arrive (`inkRender()` runs before `face.subscribe()`'s callback can
  // fire), so the very first `'stream'` request has something to coalesce
  // against — it waits one frame interval like every later one, rather than
  // reading "no prior publish" as "elapsed forever" and publishing at once.
  let lastPublishAt = clock.now()
  let disposed = false

  function clearPending(): void {
    if (pendingTimer === undefined) return
    clock.clearTimeout(pendingTimer)
    pendingTimer = undefined
  }

  function publishNow(): void {
    clearPending()
    lastPublishAt = clock.now()
    publish()
  }

  function schedule(reason: PublicationReason): void {
    if (disposed) return
    if (reason === 'structural') {
      publishNow()
      return
    }
    if (pendingTimer !== undefined) return
    const remaining = frameIntervalMs - (clock.now() - lastPublishAt)
    if (remaining <= 0) {
      publishNow()
      return
    }
    pendingTimer = clock.setTimeout(() => {
      pendingTimer = undefined
      publishNow()
    }, remaining)
  }

  function dispose(): void {
    disposed = true
    clearPending()
  }

  return { schedule, dispose }
}
