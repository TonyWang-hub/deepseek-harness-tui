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

  it('REGRESSION: text and Enter delivered in ONE stdin write still submit and clear the composer', async () => {
    // A real pty (node-pty) or a paste delivers "type text, press Enter" as a
    // single `write()`/`read()` when nothing throttles it — a single Ink
    // `useInput` event with the whole run (including the trailing `\r`) as
    // `input`. Before the `foldKeypressEvent` fix, Ink's `key.return` never
    // fires for a merged run like this (only a LONE unmerged `\r` sets it),
    // so the entire string — Enter included — was inserted as literal text
    // and nothing ever submitted: the exact "text stuck in the composer,
    // zero response" product bug this test guards against. Every other test
    // in this file (deliberately, matching this package's own pty-smoke
    // test) writes the text and `\r` as two SEPARATE `stdin.write()` calls,
    // which never exercised this merged-event path.
    const onSubmit = vi.fn()
    const instance = render(<Composer onSubmit={onSubmit} />)
    instance.stdin.write('hello\r')
    await delay(60)
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('hello')
    expect(instance.lastFrame()).toContain('❯')
    expect(instance.lastFrame()).not.toContain('hello')
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
