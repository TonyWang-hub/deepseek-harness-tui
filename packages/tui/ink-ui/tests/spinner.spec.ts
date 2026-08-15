import { describe, expect, it } from 'vitest'
import { SPINNER_FRAME_INTERVAL_MS, SPINNER_FRAMES, spinnerFrameAt } from '../src/spinner.ts'

describe('spinnerFrameAt', () => {
  it('returns the first frame at elapsed=0', () => {
    expect(spinnerFrameAt(0)).toBe(SPINNER_FRAMES[0])
  })

  it('clamps negative elapsed to the first frame', () => {
    expect(spinnerFrameAt(-500)).toBe(SPINNER_FRAMES[0])
  })

  it('advances to the second frame after one interval', () => {
    expect(spinnerFrameAt(SPINNER_FRAME_INTERVAL_MS)).toBe(SPINNER_FRAMES[1])
  })

  it('wraps around after a full cycle', () => {
    const fullCycle = SPINNER_FRAME_INTERVAL_MS * SPINNER_FRAMES.length
    expect(spinnerFrameAt(fullCycle)).toBe(SPINNER_FRAMES[0])
  })

  it('picks the last frame just before wrapping', () => {
    const lastIndex = SPINNER_FRAMES.length - 1
    expect(spinnerFrameAt(SPINNER_FRAME_INTERVAL_MS * lastIndex)).toBe(SPINNER_FRAMES[lastIndex])
  })
})
