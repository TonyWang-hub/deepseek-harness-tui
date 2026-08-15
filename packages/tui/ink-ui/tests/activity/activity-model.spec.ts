import { describe, expect, it } from 'vitest'
import type { ConversationSnapshot, PendingInteraction, RunningToolCall } from '@deepseek-ai/dsh-client-runtime/client'
import { buildActivityModel, streamingTailBudget } from '../../src/activity/activity-model.ts'

function baseSnapshot(overrides: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
  return {
    sessionId: 's1' as never,
    views: undefined as never,
    chat: undefined as never,
    nodes: [],
    turnTimings: new Map(),
    turnEnds: new Map(),
    partial: null,
    runningCalls: [],
    pending: [],
    queue: [],
    running: false,
    subagent: null,
    composerPhase: 'blank',
    removed: false,
    openState: 'open',
    openError: null,
    hasMore: false,
    loadingOlder: false,
    promptError: null,
    blank: true,
    lastAgentError: null,
    ...overrides,
  }
}

function runningCall(callId: string): RunningToolCall {
  return { callId, name: 'bash', argsRaw: '{}', turn: 0, step: 0, time: 1000, callView: null, subCalls: [] }
}

describe('streamingTailBudget', () => {
  it('reserves chrome rows on a tall terminal', () => {
    expect(streamingTailBudget(24)).toBe(18)
  })

  it('floors at the minimum on a very short terminal', () => {
    expect(streamingTailBudget(5)).toBe(3)
  })

  it('floors exactly at the boundary', () => {
    expect(streamingTailBudget(9)).toBe(3)
    expect(streamingTailBudget(10)).toBe(4)
  })
})

describe('buildActivityModel', () => {
  it('has no streaming lines when partial is null', () => {
    const model = buildActivityModel(baseSnapshot(), 24)
    expect(model.streamingLines).toEqual([])
    expect(model.streamingTruncated).toBe(false)
  })

  it('renders the partial assistant blocks as streaming lines', () => {
    const model = buildActivityModel(
      baseSnapshot({ partial: { turn: 0, step: 0, blocks: [{ kind: 'text', text: 'partial answer' }] } }),
      24,
    )
    expect(model.streamingLines).toEqual(['partial answer'])
  })

  it('truncates the streaming tail to the terminal-derived budget', () => {
    const lines = Array.from({ length: 20 }, (_, index) => `line ${index}`)
    const model = buildActivityModel(
      baseSnapshot({ partial: { turn: 0, step: 0, blocks: [{ kind: 'text', text: lines.join('\n') }] } }),
      9, // budget = 3
    )
    expect(model.streamingLines).toEqual(['line 17', 'line 18', 'line 19'])
    expect(model.streamingTruncated).toBe(true)
  })

  it('maps running tool calls to activity rows', () => {
    const model = buildActivityModel(baseSnapshot({ runningCalls: [runningCall('c1')] }), 24)
    expect(model.runningTools).toEqual([{ callId: 'c1', title: '[other] bash', startedAtMs: 1000 }])
  })

  it('splits pending interactions into approvals and questions', () => {
    const approval = { kind: 'approval', sessionId: 's1', payload: { approvalId: 'a1', toolName: 'bash' } } as unknown as Extract<PendingInteraction, { kind: 'approval' }>
    const question = { kind: 'question', sessionId: 's1', payload: { questions: [] } } as unknown as Extract<PendingInteraction, { kind: 'question' }>
    const model = buildActivityModel(baseSnapshot({ pending: [approval, question] }), 24)
    expect(model.pendingApprovals).toEqual([approval])
    expect(model.pendingQuestions).toEqual([question])
  })

  it('reports the transient inbox count', () => {
    const model = buildActivityModel(
      baseSnapshot({ queue: [{ id: 'q1' } as never] }),
      24,
    )
    expect(model.queueCount).toBe(1)
  })
})
