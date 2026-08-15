import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'ink-testing-library'
import type { PendingInteraction } from '@deepseek-ai/dsh-client-runtime/client'
import type { ActivityModel } from '../../src/activity/activity-model.ts'
import { ActivityRegion } from '../../src/components/ActivityRegion.tsx'

afterEach(() => {
  cleanup()
})

function baseActivity(overrides: Partial<ActivityModel> = {}): ActivityModel {
  return {
    streamingLines: [],
    streamingTruncated: false,
    runningTools: [],
    pendingApprovals: [],
    pendingQuestions: [],
    queueCount: 0,
    ...overrides,
  }
}

function fakeApproval(): Extract<PendingInteraction, { kind: 'approval' }> {
  return {
    kind: 'approval',
    key: 'a:1',
    sessionId: 's1' as never,
    payload: { approvalId: 'appr-1' as never, toolName: 'bash' },
    respond: async () => ({}),
    markSettled: () => {},
  } as unknown as Extract<PendingInteraction, { kind: 'approval' }>
}

function fakeQuestion(): Extract<PendingInteraction, { kind: 'question' }> {
  return {
    kind: 'question',
    key: 'q:1',
    sessionId: 's1' as never,
    payload: { questions: [{ id: 'x', question: 'Which?', options: [{ label: 'a' }] }] },
    respond: async () => ({}),
    markSettled: () => {},
  } as unknown as Extract<PendingInteraction, { kind: 'question' }>
}

describe('ActivityRegion', () => {
  it('renders the composer alone when there is no other activity', async () => {
    const instance = render(<ActivityRegion activity={baseActivity()} onSubmit={() => {}} />)
    await delay(60)
    expect(instance.lastFrame()).toContain('❯')
  })

  it('renders streaming lines and a truncation marker', async () => {
    const instance = render(
      <ActivityRegion activity={baseActivity({ streamingLines: ['partial text'], streamingTruncated: true })} onSubmit={() => {}} />,
    )
    await delay(60)
    expect(instance.lastFrame()).toContain('⋯')
    expect(instance.lastFrame()).toContain('partial text')
  })

  it('renders running tool rows', async () => {
    const instance = render(
      <ActivityRegion
        activity={baseActivity({ runningTools: [{ callId: 'c1', title: '[execute] bash', startedAtMs: Date.now() }] })}
        onSubmit={() => {}}
      />,
    )
    await delay(60)
    expect(instance.lastFrame()).toContain('[execute] bash')
  })

  it('renders the queued-count hint', async () => {
    const instance = render(<ActivityRegion activity={baseActivity({ queueCount: 2 })} onSubmit={() => {}} />)
    await delay(60)
    expect(instance.lastFrame()).toContain('(2 queued)')
  })

  it('focuses an approval prompt and deactivates the composer', async () => {
    const instance = render(<ActivityRegion activity={baseActivity({ pendingApprovals: [fakeApproval()] })} onSubmit={() => {}} />)
    await delay(60)
    expect(instance.lastFrame()).toContain('Approve bash?')
  })

  it('focuses a question prompt when there is no approval', async () => {
    const instance = render(<ActivityRegion activity={baseActivity({ pendingQuestions: [fakeQuestion()] })} onSubmit={() => {}} />)
    await delay(60)
    expect(instance.lastFrame()).toContain('Which?')
  })

  it('prioritizes an approval over a question when both are pending', async () => {
    const instance = render(
      <ActivityRegion
        activity={baseActivity({ pendingApprovals: [fakeApproval()], pendingQuestions: [fakeQuestion()] })}
        onSubmit={() => {}}
      />,
    )
    await delay(60)
    expect(instance.lastFrame()).toContain('Approve bash?')
    expect(instance.lastFrame()).not.toContain('Which?')
  })

  it('wires composer submission through to onSubmit', async () => {
    const onSubmit = vi.fn()
    const instance = render(<ActivityRegion activity={baseActivity()} onSubmit={onSubmit} />)
    instance.stdin.write('hi')
    await delay(60)
    instance.stdin.write('\r')
    await delay(60)
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('hi')
  })
})
