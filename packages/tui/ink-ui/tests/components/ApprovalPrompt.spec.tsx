import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'ink-testing-library'
import type { PendingInteraction } from '@deepseek-ai/dsh-client-runtime/client'
import { ApprovalPrompt } from '../../src/components/ApprovalPrompt.tsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function fakeApproval(
  respond: (result: unknown) => Promise<unknown>,
): Extract<PendingInteraction, { kind: 'approval' }> {
  return {
    kind: 'approval',
    key: 'a:1',
    sessionId: 's1' as never,
    payload: { approvalId: 'appr-1' as never, toolName: 'bash', reason: 'writes a file' },
    respond: respond as never,
    markSettled: () => {},
  } as unknown as Extract<PendingInteraction, { kind: 'approval' }>
}

describe('ApprovalPrompt', () => {
  it('renders the tool name and reason with y/n hints', async () => {
    const approval = fakeApproval(async () => ({}))
    const instance = render(<ApprovalPrompt approval={approval} />)
    await delay(60)
    expect(instance.lastFrame()).toContain('Approve bash?')
    expect(instance.lastFrame()).toContain('writes a file')
    expect(instance.lastFrame()).toContain('[y] allow once')
  })

  it('renders with no reason line suppressed when reason is absent', async () => {
    const approval = fakeApproval(async () => ({}))
    Object.assign(approval.payload, { reason: undefined })
    const instance = render(<ApprovalPrompt approval={approval} />)
    await delay(60)
    expect(instance.lastFrame()).toContain('Approve bash?')
  })

  it('"y" responds with allowed-once', async () => {
    const respond = vi.fn(async () => ({}))
    const approval = fakeApproval(respond)
    const instance = render(<ApprovalPrompt approval={approval} />)
    instance.stdin.write('y')
    await delay(60)
    expect(respond).toHaveBeenCalledExactlyOnceWith({
      ok: true,
      value: { sessionId: 's1', approvalId: 'appr-1', outcome: 'allowed-once' },
    })
  })

  it('"n" responds with rejected', async () => {
    const respond = vi.fn(async () => ({}))
    const approval = fakeApproval(respond)
    const instance = render(<ApprovalPrompt approval={approval} />)
    instance.stdin.write('n')
    await delay(60)
    expect(respond).toHaveBeenCalledExactlyOnceWith({
      ok: true,
      value: { sessionId: 's1', approvalId: 'appr-1', outcome: 'rejected' },
    })
  })

  it('ignores an unrelated keystroke', async () => {
    const respond = vi.fn(async () => ({}))
    const approval = fakeApproval(respond)
    const instance = render(<ApprovalPrompt approval={approval} />)
    instance.stdin.write('x')
    await delay(60)
    expect(respond).not.toHaveBeenCalled()
  })

  it('ignores a second keystroke after already answering', async () => {
    const respond = vi.fn(async () => ({}))
    const approval = fakeApproval(respond)
    const instance = render(<ApprovalPrompt approval={approval} />)
    instance.stdin.write('y')
    await delay(60)
    instance.stdin.write('n')
    await delay(60)
    expect(respond).toHaveBeenCalledTimes(1)
  })

  it('logs an error when respond() rejects', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const approval = fakeApproval(async () => { throw new Error('already settled') })
    const instance = render(<ApprovalPrompt approval={approval} />)
    instance.stdin.write('y')
    await delay(60)
    expect(errorSpy).toHaveBeenCalledWith('ApprovalPrompt: respond() failed', expect.any(Error))
  })

  it('ignores input while isActive is false', async () => {
    const respond = vi.fn(async () => ({}))
    const approval = fakeApproval(respond)
    const instance = render(<ApprovalPrompt approval={approval} isActive={false} />)
    instance.stdin.write('y')
    await delay(60)
    expect(respond).not.toHaveBeenCalled()
  })
})
