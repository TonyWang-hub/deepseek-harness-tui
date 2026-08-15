import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from 'ink-testing-library'
import { ToolRunningRow } from '../../src/components/ToolRunningRow.tsx'

afterEach(() => {
  cleanup()
})

describe('ToolRunningRow', () => {
  it('renders the title with a spinner frame prefix', async () => {
    const instance = render(<ToolRunningRow title="[execute] bash" startedAtMs={Date.now()} />)
    await delay(60)
    expect(instance.lastFrame()).toContain('[execute] bash')
  })

  it('advances the spinner frame over time', async () => {
    const instance = render(<ToolRunningRow title="[execute] bash" startedAtMs={Date.now()} />)
    const first = instance.lastFrame()
    await delay(200)
    const later = instance.lastFrame()
    expect(later).not.toBe(first)
  })
})
