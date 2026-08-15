import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'ink-testing-library'
import type { PendingInteraction } from '@deepseek-ai/dsh-client-runtime/client'
import { QuestionPrompt } from '../../src/components/QuestionPrompt.tsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function fakeQuestion(
  questions: readonly { id: string; question: string; options?: { label: string }[] }[],
  respond: (result: unknown) => Promise<unknown> = async () => ({}),
): Extract<PendingInteraction, { kind: 'question' }> {
  return {
    kind: 'question',
    key: 'q:1',
    sessionId: 's1' as never,
    payload: { questions },
    respond: respond as never,
    markSettled: () => {},
  } as unknown as Extract<PendingInteraction, { kind: 'question' }>
}

describe('QuestionPrompt', () => {
  it('renders the question and its numbered options', async () => {
    const question = fakeQuestion([{ id: 'mode', question: 'Which mode?', options: [{ label: 'fast' }, { label: 'thorough' }] }])
    const instance = render(<QuestionPrompt question={question} />)
    await delay(60)
    expect(instance.lastFrame()).toContain('Which mode?')
    expect(instance.lastFrame()).toContain('1. fast')
    expect(instance.lastFrame()).toContain('2. thorough')
  })

  it('a number key selects and responds with that option', async () => {
    const respond = vi.fn(async () => ({}))
    const question = fakeQuestion([{ id: 'mode', question: 'Which mode?', options: [{ label: 'fast' }, { label: 'thorough' }] }], respond)
    const instance = render(<QuestionPrompt question={question} />)
    instance.stdin.write('2')
    await delay(60)
    expect(respond).toHaveBeenCalledExactlyOnceWith({
      ok: true,
      value: { sessionId: 's1', answer: { answers: [{ id: 'mode', selected: ['thorough'] }] } },
    })
  })

  it('down arrow then Enter selects the second option', async () => {
    const respond = vi.fn(async () => ({}))
    const question = fakeQuestion([{ id: 'mode', question: 'Which mode?', options: [{ label: 'fast' }, { label: 'thorough' }] }], respond)
    const instance = render(<QuestionPrompt question={question} />)
    instance.stdin.write('[B') // down arrow
    await delay(60)
    instance.stdin.write('\r')
    await delay(60)
    expect(respond).toHaveBeenCalledExactlyOnceWith({
      ok: true,
      value: { sessionId: 's1', answer: { answers: [{ id: 'mode', selected: ['thorough'] }] } },
    })
  })

  it('up arrow at the first option stays on it (clamped)', async () => {
    const respond = vi.fn(async () => ({}))
    const question = fakeQuestion([{ id: 'mode', question: 'Which mode?', options: [{ label: 'fast' }, { label: 'thorough' }] }], respond)
    const instance = render(<QuestionPrompt question={question} />)
    instance.stdin.write('[A') // up arrow, already at index 0
    await delay(60)
    instance.stdin.write('\r')
    await delay(60)
    expect(respond).toHaveBeenCalledExactlyOnceWith({
      ok: true,
      value: { sessionId: 's1', answer: { answers: [{ id: 'mode', selected: ['fast'] }] } },
    })
  })

  it('down arrow then up arrow returns to the first option', async () => {
    const respond = vi.fn(async () => ({}))
    const question = fakeQuestion([{ id: 'mode', question: 'Which mode?', options: [{ label: 'fast' }, { label: 'thorough' }] }], respond)
    const instance = render(<QuestionPrompt question={question} />)
    instance.stdin.write('[B') // down arrow: cursor 0 -> 1
    await delay(60)
    instance.stdin.write('[A') // up arrow: cursor 1 -> 0 (the decrement path, not the clamp)
    await delay(60)
    instance.stdin.write('\r')
    await delay(60)
    expect(respond).toHaveBeenCalledExactlyOnceWith({
      ok: true,
      value: { sessionId: 's1', answer: { answers: [{ id: 'mode', selected: ['fast'] }] } },
    })
  })

  it('down arrow at the last option stays on it (clamped)', async () => {
    const respond = vi.fn(async () => ({}))
    const question = fakeQuestion([{ id: 'mode', question: 'Which mode?', options: [{ label: 'fast' }, { label: 'thorough' }] }], respond)
    const instance = render(<QuestionPrompt question={question} />)
    instance.stdin.write('[B') // down arrow: cursor 0 -> 1 (last option)
    await delay(60)
    instance.stdin.write('[B') // down arrow again: already at the last option, clamped
    await delay(60)
    instance.stdin.write('\r')
    await delay(60)
    expect(respond).toHaveBeenCalledExactlyOnceWith({
      ok: true,
      value: { sessionId: 's1', answer: { answers: [{ id: 'mode', selected: ['thorough'] }] } },
    })
  })

  it('an unmapped key (neither a digit nor Enter) is ignored', async () => {
    const respond = vi.fn(async () => ({}))
    const question = fakeQuestion([{ id: 'mode', question: 'Which mode?', options: [{ label: 'fast' }] }], respond)
    const instance = render(<QuestionPrompt question={question} />)
    instance.stdin.write('x')
    await delay(60)
    expect(respond).not.toHaveBeenCalled()
  })

  it('a number key beyond the option count is ignored', async () => {
    const respond = vi.fn(async () => ({}))
    const question = fakeQuestion([{ id: 'mode', question: 'Which mode?', options: [{ label: 'fast' }] }], respond)
    const instance = render(<QuestionPrompt question={question} />)
    instance.stdin.write('9')
    await delay(60)
    expect(respond).not.toHaveBeenCalled()
  })

  it('shows a note when the question has no options (free text, unsupported)', async () => {
    const question = fakeQuestion([{ id: 'name', question: 'What is your name?' }])
    const instance = render(<QuestionPrompt question={question} />)
    await delay(60)
    expect(instance.lastFrame()).toContain('free-text questions are not yet supported')
  })

  it('shows a note when the payload has more than one sub-question', async () => {
    const question = fakeQuestion([
      { id: 'a', question: 'First?', options: [{ label: 'yes' }] },
      { id: 'b', question: 'Second?', options: [{ label: 'yes' }] },
    ])
    const instance = render(<QuestionPrompt question={question} />)
    await delay(60)
    expect(instance.lastFrame()).toContain('only the first of multiple sub-questions')
  })

  it('renders a malformed-payload notice when questions is empty', async () => {
    const question = fakeQuestion([])
    const instance = render(<QuestionPrompt question={question} />)
    await delay(60)
    expect(instance.lastFrame()).toContain('malformed payload')
  })

  it('ignores a second answer after already answering', async () => {
    const respond = vi.fn(async () => ({}))
    const question = fakeQuestion([{ id: 'mode', question: 'Which mode?', options: [{ label: 'fast' }] }], respond)
    const instance = render(<QuestionPrompt question={question} />)
    instance.stdin.write('1')
    await delay(60)
    instance.stdin.write('1')
    await delay(60)
    expect(respond).toHaveBeenCalledTimes(1)
  })

  it('logs an error when respond() rejects', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const question = fakeQuestion(
      [{ id: 'mode', question: 'Which mode?', options: [{ label: 'fast' }] }],
      async () => { throw new Error('already settled') },
    )
    const instance = render(<QuestionPrompt question={question} />)
    instance.stdin.write('1')
    await delay(60)
    expect(errorSpy).toHaveBeenCalledWith('QuestionPrompt: respond() failed', expect.any(Error))
  })

  it('ignores input while isActive is false', async () => {
    const respond = vi.fn(async () => ({}))
    const question = fakeQuestion([{ id: 'mode', question: 'Which mode?', options: [{ label: 'fast' }] }], respond)
    const instance = render(<QuestionPrompt question={question} isActive={false} />)
    instance.stdin.write('1')
    await delay(60)
    expect(respond).not.toHaveBeenCalled()
  })
})
