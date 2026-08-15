import { describe, expect, it } from 'vitest'
import type {
  DiffResultView, GenericResultView, TerminalResultView, ToolCallView,
} from '@deepseek-ai/dsh-tools/presentation'
import { renderToolResultCardLines, runningToolTitle } from '../../src/transcript/tool-cards.ts'
import { style } from '../../src/ansi/style.ts'

describe('renderToolResultCardLines: generic card (default/fallback path)', () => {
  it('renders a title, kind label, and content when resultView is null', () => {
    const lines = renderToolResultCardLines({
      callName: 'read',
      callView: { card: 'generic', title: 'Read foo.txt', kind: 'read' },
      resultView: null,
      content: [{ type: 'text', text: 'file contents' }],
      isError: false,
    })
    expect(lines[0]).toContain('[read]')
    expect(lines[0]).toContain('Read foo.txt')
    expect(lines).toContain('file contents')
  })

  it('falls back to callName when no callView is present', () => {
    const lines = renderToolResultCardLines({
      callName: 'bash', callView: null, resultView: null, content: [], isError: false,
    })
    expect(lines[0]).toContain('bash')
    expect(lines[0]).toContain('[other]')
  })

  it('falls back to "tool call" when neither callView nor callName is present', () => {
    const lines = renderToolResultCardLines({
      callName: null, callView: null, resultView: null, content: [], isError: false,
    })
    expect(lines[0]).toContain('tool call')
  })

  it('marks an error result', () => {
    const lines = renderToolResultCardLines({
      callName: 'bash', callView: null, resultView: null, content: [], isError: true,
    })
    expect(lines[0]).toContain('(error)')
  })

  it('renders a string rawInput verbatim', () => {
    const lines = renderToolResultCardLines({
      callName: 'x',
      callView: { card: 'generic', title: 'x', rawInput: 'job-123' },
      resultView: null,
      content: [],
      isError: false,
    })
    expect(lines).toContain('job-123')
  })

  it('renders an object rawInput as pretty JSON', () => {
    const lines = renderToolResultCardLines({
      callName: 'x',
      callView: { card: 'generic', title: 'x', rawInput: { a: 1 } },
      resultView: null,
      content: [],
      isError: false,
    })
    expect(lines.join('\n')).toContain('"a": 1')
  })

  it('omits rawInput lines when rawInput is undefined', () => {
    const lines = renderToolResultCardLines({
      callName: 'x',
      callView: { card: 'generic', title: 'x' },
      resultView: null,
      content: [],
      isError: false,
    })
    expect(lines).toHaveLength(1)
  })

  it('omits rawInput lines when rawInput is an empty string', () => {
    const lines = renderToolResultCardLines({
      callName: 'x',
      callView: { card: 'generic', title: 'x', rawInput: '' },
      resultView: null,
      content: [],
      isError: false,
    })
    expect(lines).toHaveLength(1)
  })

  it('prefers resultView.content over the raw content when present', () => {
    const resultView: GenericResultView = { card: 'generic', content: [{ type: 'text', text: 'result text' }] }
    const lines = renderToolResultCardLines({
      callName: 'x', callView: null, resultView, content: [{ type: 'text', text: 'raw text' }], isError: false,
    })
    expect(lines).toContain('result text')
    expect(lines).not.toContain('raw text')
  })

  it('prefers resultView.title over callView.title', () => {
    const resultView: GenericResultView = { card: 'generic', title: 'Done' }
    const lines = renderToolResultCardLines({
      callName: 'x',
      callView: { card: 'generic', title: 'Running' },
      resultView,
      content: [],
      isError: false,
    })
    expect(lines[0]).toContain('Done')
  })

  it('falls back to the generic card for a search/read/web resultView.card (documented deferred cards)', () => {
    const lines = renderToolResultCardLines({
      callName: 'grep',
      callView: { card: 'generic', title: 'Search', kind: 'search' },
      resultView: { card: 'search', shape: 'paths', paths: ['a.ts'], truncated: false, total: 1 } as unknown as never,
      content: [{ type: 'text', text: 'a.ts' }],
      isError: false,
    })
    expect(lines[0]).toContain('Search')
  })
})

describe('renderToolResultCardLines: terminal card', () => {
  const baseResultView: TerminalResultView = { card: 'terminal', title: 'echo hi' }

  it('renders the command header and sanitized output', () => {
    const lines = renderToolResultCardLines({
      callName: 'bash',
      callView: { card: 'terminal', title: 'echo hi' },
      resultView: { ...baseResultView, output: 'hi\n' },
      content: [],
      isError: false,
    })
    expect(lines[0]).toContain('$ echo hi')
    expect(lines).toContain('hi')
  })

  it('renders the call view\'s description above the output', () => {
    const lines = renderToolResultCardLines({
      callName: 'bash',
      callView: { card: 'terminal', title: 'echo hi', description: 'Say hi' },
      resultView: baseResultView,
      content: [],
      isError: false,
    })
    expect(lines).toContain('Say hi')
  })

  it('renders a zero exit code as dim (non-error)', () => {
    const lines = renderToolResultCardLines({
      callName: 'bash', callView: null, resultView: { ...baseResultView, exitCode: 0 }, content: [], isError: false,
    })
    expect(lines.some(line => line.includes('[exit 0]'))).toBe(true)
  })

  it('renders a non-zero exit code as an error', () => {
    const lines = renderToolResultCardLines({
      callName: 'bash', callView: null, resultView: { ...baseResultView, exitCode: 1 }, content: [], isError: true,
    })
    expect(lines.some(line => line.includes('[exit 1]'))).toBe(true)
  })

  it('renders a signal when the process was killed and no exit code is present', () => {
    const lines = renderToolResultCardLines({
      callName: 'bash', callView: null, resultView: { ...baseResultView, signal: 'SIGTERM' }, content: [], isError: true,
    })
    expect(lines.some(line => line.includes('[signal SIGTERM]'))).toBe(true)
  })

  it('renders no status pill when neither exitCode nor signal is present', () => {
    const lines = renderToolResultCardLines({
      callName: 'bash', callView: null, resultView: baseResultView, content: [], isError: false,
    })
    expect(lines.some(line => line.includes('[exit') || line.includes('[signal'))).toBe(false)
  })

  it('falls back to the call view\'s title when the result view carries none', () => {
    const lines = renderToolResultCardLines({
      callName: 'bash',
      callView: { card: 'terminal', title: 'ls -la' },
      resultView: { card: 'terminal' },
      content: [],
      isError: false,
    })
    expect(lines[0]).toContain('$ ls -la')
  })

  it('renders only the header line when output is empty and no exit status is present', () => {
    const lines = renderToolResultCardLines({
      callName: 'bash', callView: null, resultView: { ...baseResultView, output: '' }, content: [], isError: false,
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('$ echo hi')
  })

  it('renders a bare "$ " header when neither the result view nor the call view carries a title', () => {
    const lines = renderToolResultCardLines({
      callName: 'bash', callView: null, resultView: { card: 'terminal' }, content: [], isError: false,
    })
    expect(lines[0]).toBe(style.title('$ '))
  })
})

describe('renderToolResultCardLines: diff card', () => {
  it('renders added and removed lines with a footer', () => {
    const resultView: DiffResultView = {
      card: 'diff',
      diffs: [{ path: 'foo.txt', oldText: 'old line', newText: 'new line' }],
    }
    const lines = renderToolResultCardLines({
      callName: 'edit', callView: null, resultView, content: [], isError: false,
    })
    expect(lines.some(line => line.includes('foo.txt'))).toBe(true)
    expect(lines.some(line => line.includes('- old line'))).toBe(true)
    expect(lines.some(line => line.includes('+ new line'))).toBe(true)
    expect(lines.at(-1)).toContain('+1 -1 · 1 file')
  })

  it('renders a pure insertion (oldText: null) with no removed lines', () => {
    const resultView: DiffResultView = {
      card: 'diff',
      diffs: [{ path: 'new.txt', oldText: null, newText: 'brand new' }],
    }
    const lines = renderToolResultCardLines({
      callName: 'write', callView: null, resultView, content: [], isError: false,
    })
    expect(lines.some(line => line.includes('+ brand new'))).toBe(true)
    expect(lines.some(line => line.startsWith('- '))).toBe(false)
  })

  it('renders unchanged context lines without a +/- marker', () => {
    const resultView: DiffResultView = {
      card: 'diff',
      diffs: [{ path: 'foo.txt', oldText: 'a\nb\nc', newText: 'a\nB\nc' }],
    }
    const lines = renderToolResultCardLines({
      callName: 'edit', callView: null, resultView, content: [], isError: false,
    })
    expect(lines.some(line => line.trim() === 'a')).toBe(true)
    expect(lines.some(line => line.includes('- b'))).toBe(true)
    expect(lines.some(line => line.includes('+ B'))).toBe(true)
  })

  it('multi-file diffs count distinct files, not distinct hunks', () => {
    const resultView: DiffResultView = {
      card: 'diff',
      diffs: [
        { path: 'a.txt', oldText: 'x', newText: 'y' },
        { path: 'a.txt', oldText: 'p', newText: 'q' },
        { path: 'b.txt', oldText: null, newText: 'z' },
      ],
    }
    const lines = renderToolResultCardLines({
      callName: 'edit', callView: null, resultView, content: [], isError: false,
    })
    expect(lines.at(-1)).toContain('· 2 files')
  })

  it('uses the default "Diff" title when resultView carries none', () => {
    const resultView: DiffResultView = { card: 'diff', diffs: [] }
    const lines = renderToolResultCardLines({
      callName: 'edit', callView: null, resultView, content: [], isError: false,
    })
    expect(lines[0]).toContain('Diff')
    expect(lines.at(-1)).toContain('· 0 files')
  })

  it('skips a diff change whose value is only a trailing newline (an inserted blank line renders no row)', () => {
    const resultView: DiffResultView = {
      card: 'diff',
      diffs: [{ path: 'foo.txt', oldText: 'a\nb', newText: 'a\n\nb' }],
    }
    const lines = renderToolResultCardLines({
      callName: 'edit', callView: null, resultView, content: [], isError: false,
    })
    // Two context lines ('a', 'b') plus the path header and footer; the
    // inserted blank line contributes no row of its own.
    expect(lines.some(line => line.includes('+ '))).toBe(false)
    expect(lines.at(-1)).toContain('+0 -0')
  })
})

describe('runningToolTitle', () => {
  it('uses the call view\'s title and kind when present', () => {
    const callView: ToolCallView = { card: 'generic', title: 'Reading foo.txt', kind: 'read' }
    expect(runningToolTitle(callView, 'read')).toBe('[read] Reading foo.txt')
  })

  it('falls back to the tool\'s bare name when callView is null', () => {
    expect(runningToolTitle(null, 'bash')).toBe('[other] bash')
  })
})
