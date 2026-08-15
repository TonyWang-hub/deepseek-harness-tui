import { describe, expect, it } from 'vitest'
import { RendererConfig, resolveRendererConfig } from '../src/config.ts'

describe('resolveRendererConfig', () => {
  it('defaults publishRateFps to 30 and sessionListTimeoutMs to 5000 when no config is given', () => {
    expect(resolveRendererConfig()).toEqual({ publishRateFps: 30, sessionListTimeoutMs: 5000 })
  })

  it('defaults both fields when config is an empty object', () => {
    expect(resolveRendererConfig({})).toEqual({ publishRateFps: 30, sessionListTimeoutMs: 5000 })
  })

  it('accepts an explicit in-range publishRateFps', () => {
    expect(resolveRendererConfig({ publishRateFps: 60 }).publishRateFps).toBe(60)
  })

  it('accepts the publishRateFps lower bound (1)', () => {
    expect(resolveRendererConfig({ publishRateFps: 1 }).publishRateFps).toBe(1)
  })

  it('accepts the upper bound (240)', () => {
    expect(resolveRendererConfig({ publishRateFps: 240 }).publishRateFps).toBe(240)
  })

  it('rejects publishRateFps below the lower bound', () => {
    expect(() => resolveRendererConfig({ publishRateFps: 0 })).toThrow()
  })

  it('rejects publishRateFps above the upper bound', () => {
    expect(() => resolveRendererConfig({ publishRateFps: 241 })).toThrow()
  })

  it('rejects a non-integer publishRateFps', () => {
    expect(() => resolveRendererConfig({ publishRateFps: 29.5 })).toThrow()
  })

  it('accepts an explicit in-range sessionListTimeoutMs', () => {
    expect(resolveRendererConfig({ sessionListTimeoutMs: 10_000 }).sessionListTimeoutMs).toBe(10_000)
  })

  it('accepts the sessionListTimeoutMs lower bound (1)', () => {
    expect(resolveRendererConfig({ sessionListTimeoutMs: 1 }).sessionListTimeoutMs).toBe(1)
  })

  it('accepts the upper bound (60000)', () => {
    expect(resolveRendererConfig({ sessionListTimeoutMs: 60_000 }).sessionListTimeoutMs).toBe(60_000)
  })

  it('rejects sessionListTimeoutMs below the lower bound', () => {
    expect(() => resolveRendererConfig({ sessionListTimeoutMs: 0 })).toThrow()
  })

  it('rejects sessionListTimeoutMs above the upper bound', () => {
    expect(() => resolveRendererConfig({ sessionListTimeoutMs: 60_001 })).toThrow()
  })
})

describe('RendererConfig schema', () => {
  it('is directly callable to validate a raw config object', () => {
    expect(RendererConfig({ publishRateFps: 15 })).toEqual({ publishRateFps: 15, sessionListTimeoutMs: 5000 })
  })
})
