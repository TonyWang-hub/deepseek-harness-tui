import { describe, expect, it } from 'vitest'
import { style } from '../../src/ansi/style.ts'

// chalk auto-detects color support; under vitest's non-TTY stdout it
// typically emits no SGR codes, so these assertions check that the
// original text always survives (the behavior every consumer relies on),
// not exact ANSI byte sequences the test environment cannot pin.
describe('style', () => {
  it('title() preserves the input text', () => {
    expect(style.title('Write foo.txt')).toContain('Write foo.txt')
  })

  it('dim() preserves the input text', () => {
    expect(style.dim('hint')).toContain('hint')
  })

  it('userRole() preserves the input text', () => {
    expect(style.userRole('❯ you')).toContain('❯ you')
  })

  it('assistantRole() preserves the input text', () => {
    expect(style.assistantRole('● assistant')).toContain('● assistant')
  })

  it('error() preserves the input text', () => {
    expect(style.error('[exit 1]')).toContain('[exit 1]')
  })

  it('diffAdd() preserves the input text', () => {
    expect(style.diffAdd('+ added line')).toContain('+ added line')
  })

  it('diffDel() preserves the input text', () => {
    expect(style.diffDel('- removed line')).toContain('- removed line')
  })

  it('diffContext() preserves the input text', () => {
    expect(style.diffContext('  unchanged line')).toContain('  unchanged line')
  })
})
