import { describe, expect, it } from 'vitest'
import { createPublicationScheduler } from '../../src/scheduler/publication-scheduler.ts'
import type { ResolvedRendererConfig } from '../../src/config.ts'
import { createManualClock } from '../support/manual-clock.ts'

const CONFIG_30_FPS: ResolvedRendererConfig = { publishRateFps: 30, sessionListTimeoutMs: 5000 }

describe('createPublicationScheduler', () => {
  it('publishes immediately for a structural reason', () => {
    const clock = createManualClock()
    let publishCount = 0
    const scheduler = createPublicationScheduler(() => { publishCount++ }, CONFIG_30_FPS, clock)
    scheduler.schedule('structural')
    expect(publishCount).toBe(1)
  })

  it('coalesces multiple stream requests within one frame interval into a single publish', () => {
    const clock = createManualClock()
    let publishCount = 0
    const scheduler = createPublicationScheduler(() => { publishCount++ }, CONFIG_30_FPS, clock)
    scheduler.schedule('stream')
    scheduler.schedule('stream')
    scheduler.schedule('stream')
    expect(publishCount).toBe(0)
    expect(clock.pendingCount()).toBe(1)
    clock.advanceTo(1000)
    clock.fireDue()
    expect(publishCount).toBe(1)
  })

  it('publishes a stream request immediately when the frame interval has already elapsed', () => {
    const clock = createManualClock()
    let publishCount = 0
    const scheduler = createPublicationScheduler(() => { publishCount++ }, CONFIG_30_FPS, clock)
    scheduler.schedule('structural') // sets lastPublishAt = 0
    clock.advanceTo(1000) // well past one frame interval (~34ms at 30fps)
    scheduler.schedule('stream')
    expect(publishCount).toBe(2)
    expect(clock.pendingCount()).toBe(0)
  })

  it('a structural request cancels a pending coalesced stream timer and publishes once', () => {
    const clock = createManualClock()
    let publishCount = 0
    const scheduler = createPublicationScheduler(() => { publishCount++ }, CONFIG_30_FPS, clock)
    scheduler.schedule('stream')
    expect(clock.pendingCount()).toBe(1)
    scheduler.schedule('structural')
    expect(publishCount).toBe(1)
    expect(clock.pendingCount()).toBe(0)
  })

  it('a subsequent stream request after a structural publish starts a fresh interval (no double publish)', () => {
    const clock = createManualClock()
    let publishCount = 0
    const scheduler = createPublicationScheduler(() => { publishCount++ }, CONFIG_30_FPS, clock)
    scheduler.schedule('structural')
    expect(publishCount).toBe(1)
    scheduler.schedule('stream')
    expect(publishCount).toBe(1)
    expect(clock.pendingCount()).toBe(1)
  })

  it('dispose() clears a pending timer and stops accepting further schedule() calls', () => {
    const clock = createManualClock()
    let publishCount = 0
    const scheduler = createPublicationScheduler(() => { publishCount++ }, CONFIG_30_FPS, clock)
    scheduler.schedule('stream')
    expect(clock.pendingCount()).toBe(1)
    scheduler.dispose()
    expect(clock.pendingCount()).toBe(0)
    scheduler.schedule('structural')
    scheduler.schedule('stream')
    expect(publishCount).toBe(0)
  })

  it('dispose() is a no-op when nothing is pending', () => {
    const clock = createManualClock()
    const scheduler = createPublicationScheduler(() => {}, CONFIG_30_FPS, clock)
    expect(() => { scheduler.dispose() }).not.toThrow()
  })

  it('uses the real clock/timers when none is injected', () => {
    return new Promise<void>((resolve) => {
      const scheduler = createPublicationScheduler(() => {
        scheduler.dispose()
        resolve()
      }, { publishRateFps: 240, sessionListTimeoutMs: 5000 })
      scheduler.schedule('structural')
    })
  })

  it('dispose() with the real clock clears a genuinely pending real setTimeout', () => {
    let publishCount = 0
    const scheduler = createPublicationScheduler(() => { publishCount++ }, { publishRateFps: 1, sessionListTimeoutMs: 5000 })
    scheduler.schedule('stream') // sets a real ~1000ms setTimeout
    scheduler.dispose() // must clear it via REAL_CLOCK.clearTimeout, not just stop accepting new schedules
    expect(publishCount).toBe(0)
  })
})
