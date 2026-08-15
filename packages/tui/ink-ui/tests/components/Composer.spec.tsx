import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'ink-testing-library'
import { Box, Text } from 'ink'
import { Composer } from '../../src/components/Composer.tsx'
import { HeadlessTerminal, mountInk } from '../support/headless-terminal.ts'

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

  // Real terminal cursor placement is invisible to `ink-testing-library`'s
  // `lastFrame()` (see `tests/tui.snapshot.ts`'s module doc), so this reads
  // the actual cursor row back through the headless-terminal harness instead,
  // over three filler rows standing in for `ActivityRegion`'s measured region
  // above the composer — proving the `rowOffset` arithmetic directly, without
  // going through the activity model or its own row-measuring effect.
  it('reports the terminal cursor row as rowOffset plus its own internal row', async () => {
    const terminal = new HeadlessTerminal(80, 10)
    const rowOffset = 3
    const ink = await mountInk(
      terminal,
      <Box flexDirection="column">
        <Text>one</Text>
        <Text>two</Text>
        <Text>three</Text>
        <Composer onSubmit={() => {}} rowOffset={rowOffset} />
      </Box>,
    )
    // Two logical lines via a literal newline byte puts the caret (and so the
    // composer's own cursorY) on internal row 1, distinct from row 0 — the
    // case the fixed `rowOffset` plumbing (`Composer.tsx`, `ActivityRegion.tsx`)
    // exists to get right, not just the row-0 case every other checkpoint pins.
    await ink.type('first\nsecond')
    const snapshot = await terminal.snapshot()
    expect(snapshot).toContain(`cursor visible column=8 viewportRow=${rowOffset + 1} bufferRow=${rowOffset + 1}`)
    await ink.dispose()
  })
})
