import { describe, expect, it } from 'vitest'
import type { AssistantBlock, ConversationNode } from '@deepseek-ai/dsh-client-runtime/client'
import { renderAssistantBlocks, renderClosedNodeLines } from '../../src/transcript/node-lines.ts'

describe('renderClosedNodeLines', () => {
  it('renders a user message', () => {
    const node: ConversationNode = {
      kind: 'user', seq: 1, time: 0, content: [{ type: 'text', text: 'hi there' }], source: undefined,
    }
    const lines = renderClosedNodeLines(node)
    expect(lines[0]).toContain('you')
    expect(lines).toContain('hi there')
  })

  it('renders a steering message', () => {
    const node: ConversationNode = {
      kind: 'steering', messageId: 'm1' as never, seq: 1, time: 0, content: [{ type: 'text', text: 'steer text' }], source: undefined,
    }
    const lines = renderClosedNodeLines(node)
    expect(lines[0]).toContain('steer')
    expect(lines).toContain('steer text')
  })

  it('renders a context message with a known form', () => {
    const node: ConversationNode = {
      kind: 'context', seq: 1, time: 0, content: [{ type: 'text', text: 'ctx text' }], source: undefined,
      provenance: { role: 'system' } as never, form: 'workspace-context' as never,
    }
    const lines = renderClosedNodeLines(node)
    expect(lines[0]).toContain('workspace-context')
  })

  it('renders a context message with no known form', () => {
    const node: ConversationNode = {
      kind: 'context', seq: 1, time: 0, content: [], source: undefined,
      provenance: { role: 'system' } as never, form: null,
    }
    const lines = renderClosedNodeLines(node)
    expect(lines[0]).toBe('[context]')
  })

  it('renders an assistant message', () => {
    const node: ConversationNode = {
      kind: 'assistant', seq: 1, time: 0, turn: 0, step: 0, blocks: [{ kind: 'text', text: 'final answer' }],
    }
    const lines = renderClosedNodeLines(node)
    expect(lines[0]).toContain('assistant')
    expect(lines).toContain('final answer')
  })

  it('renders a tool-result node through the tool-cards module', () => {
    const node: ConversationNode = {
      kind: 'tool-result',
      seq: 1,
      time: 0,
      callId: 'call-1',
      call: { name: 'bash', argsRaw: '{}' },
      callTime: 0,
      content: [{ type: 'text', text: 'ok' }],
      isError: false,
      callView: null,
      resultView: null,
      subCalls: [],
    }
    const lines = renderClosedNodeLines(node)
    expect(lines[0]).toContain('bash')
  })

  it('renders a tool-result node whose call head was window-truncated (call: null)', () => {
    const node: ConversationNode = {
      kind: 'tool-result',
      seq: 1,
      time: 0,
      callId: 'call-1',
      call: null,
      callTime: null,
      content: [],
      isError: false,
      callView: null,
      resultView: null,
      subCalls: [],
    }
    const lines = renderClosedNodeLines(node)
    expect(lines[0]).toContain('tool call')
  })

  it('renders a command node with args present and no name (both name-fallback occurrences)', () => {
    const node: ConversationNode = {
      kind: 'command', seq: 1, time: 0, commandId: 'cmd-1' as never, name: null, args: 'foo', outcome: null,
    }
    const lines = renderClosedNodeLines(node)
    expect(lines).toEqual(['/cmd-1 foo'])
  })

  it('renders a command node with no outcome yet', () => {
    const node: ConversationNode = {
      kind: 'command', seq: 1, time: 0, commandId: 'cmd-1' as never, name: 'model', args: null, outcome: null,
    }
    const lines = renderClosedNodeLines(node)
    expect(lines).toEqual(['/model'])
  })

  it('renders a command node with args and a successful outcome', () => {
    const node: ConversationNode = {
      kind: 'command',
      seq: 1,
      time: 0,
      commandId: 'cmd-1' as never,
      name: 'model',
      args: 'deepseek-v4',
      outcome: { kind: 'success', text: 'Model switched.' },
    }
    const lines = renderClosedNodeLines(node)
    expect(lines).toEqual(['/model deepseek-v4', 'Model switched.'])
  })

  it('renders a command node with a successful outcome carrying no text', () => {
    const node: ConversationNode = {
      kind: 'command', seq: 1, time: 0, commandId: 'cmd-1' as never, name: 'model', args: null, outcome: { kind: 'success' },
    }
    const lines = renderClosedNodeLines(node)
    expect(lines).toEqual(['/model'])
  })

  it('renders a command node with an error outcome', () => {
    const node: ConversationNode = {
      kind: 'command',
      seq: 1,
      time: 0,
      commandId: 'cmd-1' as never,
      name: null,
      args: null,
      outcome: { kind: 'error', text: 'unknown command' },
    }
    const lines = renderClosedNodeLines(node)
    expect(lines[0]).toContain('cmd-1')
    expect(lines[1]).toContain('unknown command')
  })

  it('renders a command node with an error outcome carrying no text', () => {
    const node: ConversationNode = {
      kind: 'command', seq: 1, time: 0, commandId: 'cmd-1' as never, name: 'model', args: null, outcome: { kind: 'error' },
    }
    const lines = renderClosedNodeLines(node)
    expect(lines[1]).toContain('command failed')
  })

  it('renders a compaction summary', () => {
    const node: ConversationNode = {
      kind: 'compaction', seq: 1, time: 0, summary: 'Summarized the earlier turns.', summaryEventSeq: 0, shadowedItemCount: 5, shadowedTokenCount: 100,
    }
    const lines = renderClosedNodeLines(node)
    expect(lines).toEqual(['Summarized the earlier turns.'])
  })

  it('renders a compaction summary with no summary text (fallback)', () => {
    const node: ConversationNode = {
      kind: 'compaction', seq: 1, time: 0, summary: null, summaryEventSeq: null, shadowedItemCount: 3, shadowedTokenCount: null,
    }
    const lines = renderClosedNodeLines(node)
    expect(lines[0]).toContain('3 item(s) shadowed')
  })

  it('renders a compaction summary with no summary text and no shadowed-item count (both fallbacks)', () => {
    const node: ConversationNode = {
      kind: 'compaction', seq: 1, time: 0, summary: null, summaryEventSeq: null, shadowedItemCount: null, shadowedTokenCount: null,
    }
    const lines = renderClosedNodeLines(node)
    expect(lines[0]).toContain('0 item(s) shadowed')
  })

  it('renders a model-retry node', () => {
    const node: ConversationNode = {
      kind: 'model-retry',
      seq: 1,
      time: 0,
      retryId: 'r1' as never,
      turn: 2,
      step: 3,
      provider: 'deepseek-official',
      mode: 'normal',
      policyKey: 'default',
      retry: 1,
      maxRetries: 3,
      delayMs: 1000,
      failure: {} as never,
      retryState: 'scheduled',
    }
    const lines = renderClosedNodeLines(node)
    expect(lines[0]).toContain('turn 2 step 3')
    expect(lines[0]).toContain('scheduled')
  })

  it('renders a turn-error node with a code', () => {
    const node: ConversationNode = {
      kind: 'turn-error', seq: 1, time: 0, turn: 0, step: 0, message: 'boom', code: 'CANCELLED',
    }
    const lines = renderClosedNodeLines(node)
    expect(lines[0]).toContain('boom')
    expect(lines[0]).toContain('CANCELLED')
  })

  it('renders a turn-error node with no code', () => {
    const node: ConversationNode = {
      kind: 'turn-error', seq: 1, time: 0, turn: 0, step: 0, message: 'boom',
    }
    const lines = renderClosedNodeLines(node)
    expect(lines[0]).not.toContain('(undefined)')
  })

  it('renders a turn-max-tokens node', () => {
    const node: ConversationNode = { kind: 'turn-max-tokens', seq: 1, time: 0, turn: 1, step: 2 }
    const lines = renderClosedNodeLines(node)
    expect(lines[0]).toContain('turn 1 step 2')
  })

  it('renders an unknown surface node', () => {
    const node: ConversationNode = { kind: 'unknown', seq: 1, time: 0, type: 'future/event', data: {} }
    const lines = renderClosedNodeLines(node)
    expect(lines[0]).toContain('future/event')
  })
})

describe('renderAssistantBlocks', () => {
  it('renders a text block', () => {
    expect(renderAssistantBlocks([{ kind: 'text', text: 'a\nb' }])).toEqual(['a', 'b'])
  })

  it('renders a reasoning block with a thinking marker', () => {
    const lines = renderAssistantBlocks([{ kind: 'reasoning', text: 'pondering' }])
    expect(lines[0]).toContain('(thinking) pondering')
  })

  it('renders a tool-call block as a one-line reference', () => {
    const lines = renderAssistantBlocks([{ kind: 'tool-call', callId: 'c1', name: 'bash', argsRaw: '{}' }])
    expect(lines[0]).toContain('calling bash')
  })

  it('renders an image block as a placeholder', () => {
    const lines = renderAssistantBlocks([{ kind: 'image', attachment: {} as never }])
    expect(lines[0]).toContain('[image]')
  })

  it('renders an other block as a placeholder', () => {
    const lines = renderAssistantBlocks([{ kind: 'other', block: {} }])
    expect(lines[0]).toContain('[other]')
  })

  it('renders multiple blocks in order', () => {
    const blocks: AssistantBlock[] = [
      { kind: 'text', text: 'intro' },
      { kind: 'tool-call', callId: 'c1', name: 'bash', argsRaw: '{}' },
    ]
    const lines = renderAssistantBlocks(blocks)
    expect(lines[0]).toBe('intro')
    expect(lines[1]).toContain('calling bash')
  })
})
