import { describe, expect, it } from 'vitest'
import { sanitizeTerminalOutput } from '../../src/ansi/sanitize-terminal.ts'

const ESC = '\x1b'

describe('sanitizeTerminalOutput', () => {
  it('passes plain text through unchanged', () => {
    expect(sanitizeTerminalOutput('hello world\nsecond line')).toBe('hello world\nsecond line')
  })

  it('keeps SGR color sequences intact', () => {
    const input = `${ESC}[31mred${ESC}[0m plain`
    expect(sanitizeTerminalOutput(input)).toBe(input)
  })

  it('strips an OSC sequence terminated by BEL', () => {
    expect(sanitizeTerminalOutput(`${ESC}]0;window title\x07visible`)).toBe('visible')
  })

  it('strips an OSC 8 hyperlink sequence terminated by ST', () => {
    const input = `${ESC}]8;;http://example.com${ESC}\\link text${ESC}]8;;${ESC}\\`
    expect(sanitizeTerminalOutput(input)).toBe('link text')
  })

  it('strips a DCS sequence terminated by ST', () => {
    expect(sanitizeTerminalOutput(`${ESC}P$q${ESC}\\after`)).toBe('after')
  })

  it('strips an APC sequence terminated by ST', () => {
    expect(sanitizeTerminalOutput(`${ESC}_payload${ESC}\\after`)).toBe('after')
  })

  it('strips a cursor-movement CSI sequence (screen erase)', () => {
    expect(sanitizeTerminalOutput(`before${ESC}[2Jafter`)).toBe('beforeafter')
  })

  it('strips a cursor-position CSI sequence', () => {
    expect(sanitizeTerminalOutput(`before${ESC}[10;20Hafter`)).toBe('beforeafter')
  })

  it('strips a DEC private-mode sequence (cursor visibility)', () => {
    expect(sanitizeTerminalOutput(`before${ESC}[?25lafter${ESC}[?25h`)).toBe('beforeafter')
  })

  it('strips a DEC private-mode sequence (bracketed paste)', () => {
    expect(sanitizeTerminalOutput(`${ESC}[?2004hpasted${ESC}[?2004l`)).toBe('pasted')
  })

  it('strips a charset-designation escape', () => {
    expect(sanitizeTerminalOutput(`before${ESC}(Bafter`)).toBe('beforeafter')
  })

  it('strips a single-byte-argument escape (reset)', () => {
    expect(sanitizeTerminalOutput(`before${ESC}cafter`)).toBe('beforeafter')
  })

  it('drops a stray unrecognized ESC byte via the catch-all rather than passing it through', () => {
    // 'Z' is not a prefix any specific pattern recognizes (not '[', ']',
    // 'P'/'_'/'^'/'X', '('/')', or one of the single-byte set); the ESC
    // byte itself is still dropped by the catch-all, and 'Z' survives as
    // ordinary text.
    expect(sanitizeTerminalOutput(`before${ESC}Zafter`)).toBe('beforeZafter')
  })

  it('strips other C0 control characters but keeps tab, newline, and carriage return', () => {
    expect(sanitizeTerminalOutput('a\x00bc\tD\nE\rF')).toBe('abc\tD\nE\rF')
  })

  it('handles a mix of SGR, cursor control, and OSC in one string', () => {
    const input = `${ESC}[32mgreen${ESC}[0m ${ESC}[2K${ESC}]0;title\x07 tail`
    expect(sanitizeTerminalOutput(input)).toBe(`${ESC}[32mgreen${ESC}[0m  tail`)
  })

  it('returns an empty string for empty input', () => {
    expect(sanitizeTerminalOutput('')).toBe('')
  })
})
