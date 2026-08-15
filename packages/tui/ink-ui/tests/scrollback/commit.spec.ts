import { afterEach, describe, expect, it, vi } from 'vitest'
import { commitToScrollback } from '../../src/scrollback/commit.ts'

describe('commitToScrollback', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('joins lines with newlines and logs them once', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    commitToScrollback(['line one', 'line two'])
    expect(spy).toHaveBeenCalledOnce()
    expect(spy).toHaveBeenCalledWith('line one\nline two')
  })

  it('does nothing for an empty lines array', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    commitToScrollback([])
    expect(spy).not.toHaveBeenCalled()
  })
})
