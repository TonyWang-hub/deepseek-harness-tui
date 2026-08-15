/**
 * A fully manual {@link PublicationSchedulerClock} double: `now()` is a
 * settable counter and every `setTimeout` is queued rather than real,  so a
 * test drives the publication scheduler's frame boundary by explicit
 * `advanceTo()`/`fireDue()` calls instead of racing a real wall-clock
 * `setTimeout` — the deterministic replacement for sleeping past a
 * `publishRateFps` frame interval and hoping a shared CI runner did not miss
 * it. Shared by `scheduler/publication-scheduler.spec.ts` (the scheduler unit
 * itself) and `render.spec.ts` (`mountTuiRenderer`'s `schedulerClock` test
 * seam), which both need the identical fake rather than two divergent copies.
 */
import type { PublicationSchedulerClock } from '../../src/scheduler/publication-scheduler.ts'

/** A manual clock, plus the test-only controls a real clock has no equivalent for. */
export interface ManualClock extends PublicationSchedulerClock {
  /** Move `now()` forward (or back) to `ms` without firing any timer. */
  advanceTo(ms: number): void
  /** Fire (and remove) every queued timer whose `fireAt` is at or before the current `now()`. */
  fireDue(): void
  /** Count of timers still queued (not yet fired or cleared). */
  pendingCount(): number
}

/** Create a manual clock; starts at `now() === 0` with no timers queued. */
export function createManualClock(): ManualClock {
  let now = 0
  const timers = new Map<number, { fireAt: number; handler: () => void }>()
  let nextId = 1
  return {
    now: () => now,
    setTimeout: (handler, ms) => {
      const id = nextId++
      timers.set(id, { fireAt: now + ms, handler })
      return id
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number)
    },
    advanceTo: (ms) => { now = ms },
    fireDue: () => {
      for (const [id, timer] of [...timers]) {
        if (timer.fireAt <= now) {
          timers.delete(id)
          timer.handler()
        }
      }
    },
    pendingCount: () => timers.size,
  }
}
