import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'ink-testing-library'
import type { ActivityModel } from '../../src/activity/activity-model.ts'
import { App } from '../../src/components/App.tsx'

afterEach(() => {
  cleanup()
})

const EMPTY_ACTIVITY: ActivityModel = {
  streamingLines: [],
  streamingTruncated: false,
  runningTools: [],
  pendingApprovals: [],
  pendingQuestions: [],
  queueCount: 0,
}

describe('App', () => {
  it('renders the activity region', async () => {
    const instance = render(<App activity={EMPTY_ACTIVITY} onSubmit={() => {}} onCancel={() => {}} />)
    await delay(60)
    expect(instance.lastFrame()).toContain('❯')
  })

  it('Esc calls onCancel', async () => {
    const onCancel = vi.fn()
    const instance = render(<App activity={EMPTY_ACTIVITY} onSubmit={() => {}} onCancel={onCancel} />)
    instance.stdin.write('\x1b')
    await delay(60)
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('an ordinary keystroke does not call onCancel', async () => {
    const onCancel = vi.fn()
    const instance = render(<App activity={EMPTY_ACTIVITY} onSubmit={() => {}} onCancel={onCancel} />)
    instance.stdin.write('a')
    await delay(60)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('forwards submitted composer text to onSubmit', async () => {
    const onSubmit = vi.fn()
    const instance = render(<App activity={EMPTY_ACTIVITY} onSubmit={onSubmit} onCancel={() => {}} />)
    instance.stdin.write('hi')
    await delay(60)
    instance.stdin.write('\r')
    await delay(60)
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('hi')
  })
})
