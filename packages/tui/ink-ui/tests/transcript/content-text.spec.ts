import { describe, expect, it } from 'vitest'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import { contentBlocksToLines } from '../../src/transcript/content-text.ts'

describe('contentBlocksToLines', () => {
  it('returns an empty array for undefined content', () => {
    expect(contentBlocksToLines(undefined)).toEqual([])
  })

  it('returns an empty array for empty content', () => {
    expect(contentBlocksToLines([])).toEqual([])
  })

  it('renders a text block\'s text, split into lines', () => {
    const content: ContentBlock[] = [{ type: 'text', text: 'line one\nline two' }]
    expect(contentBlocksToLines(content)).toEqual(['line one', 'line two'])
  })

  it('renders a reasoning block\'s text the same as a text block', () => {
    const content: ContentBlock[] = [{ type: 'reasoning', text: 'thinking...' }]
    expect(contentBlocksToLines(content)).toEqual(['thinking...'])
  })

  it('renders a non-text block kind as a bracketed placeholder', () => {
    const content: ContentBlock[] = [{ type: 'tool-call', id: 'call-1' as never, name: 'bash', arguments: '{}' }]
    expect(contentBlocksToLines(content)).toEqual(['[tool-call]'])
  })

  it('joins multiple blocks with newlines between them', () => {
    const content: ContentBlock[] = [
      { type: 'text', text: 'first' },
      { type: 'image', attachment: {} as never },
    ]
    expect(contentBlocksToLines(content)).toEqual(['first', '[image]'])
  })
})
