import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'ink-testing-library'
import { Composer } from '../../src/components/Composer.tsx'

afterEach(() => {
  cleanup()
})

describe('Composer', () => {
  it('renders the empty composer with the first-line prefix', async () => {
    const instance = render(<Composer onSubmit={() => {}} />)
    await delay(60)
    expect(instance.lastFrame()).toContain('❯')
  })

  it('inserts typed characters after the prefix', async () => {
    const instance = render(<Composer onSubmit={() => {}} />)
    instance.stdin.write('hi')
    await delay(60)
    expect(instance.lastFrame()).toContain('❯ hi')
  })

  it('a literal newline byte adds a continuation row without submitting', async () => {
    const onSubmit = vi.fn()
    const instance = render(<Composer onSubmit={onSubmit} />)
    instance.stdin.write('a')
    await delay(60)
    instance.stdin.write('\n')
    await delay(60)
    instance.stdin.write('b')
    await delay(60)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(instance.lastFrame()).toContain('❯ a')
    expect(instance.lastFrame()).toContain('  b')
  })

  it('Enter submits non-blank content and clears the composer', async () => {
    const onSubmit = vi.fn()
    const instance = render(<Composer onSubmit={onSubmit} />)
    instance.stdin.write('hello')
    await delay(60)
    instance.stdin.write('\r')
    await delay(60)
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('hello')
    expect(instance.lastFrame()).toContain('❯')
    expect(instance.lastFrame()).not.toContain('hello')
  })

  it('Enter on a blank composer does not submit', async () => {
    const onSubmit = vi.fn()
    const instance = render(<Composer onSubmit={onSubmit} />)
    instance.stdin.write('\r')
    await delay(60)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('backspace deletes the last character', async () => {
    const instance = render(<Composer onSubmit={() => {}} />)
    instance.stdin.write('ab')
    await delay(60)
    instance.stdin.write('\x7f')
    await delay(60)
    expect(instance.lastFrame()).toContain('❯ a')
    expect(instance.lastFrame()).not.toContain('❯ ab')
  })

  it('ignores input while isActive is false', async () => {
    const onSubmit = vi.fn()
    const instance = render(<Composer onSubmit={onSubmit} isActive={false} />)
    instance.stdin.write('hello')
    await delay(60)
    instance.stdin.write('\r')
    await delay(60)
    expect(instance.lastFrame()).not.toContain('hello')
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
