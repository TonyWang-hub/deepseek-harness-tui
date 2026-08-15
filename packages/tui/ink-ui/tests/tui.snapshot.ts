/**
 * Renderer checkpoint snapshots: each interaction state the terminal
 * application can be in, painted into a real terminal emulator by a real Ink
 * mount, and pinned as a cell-level semantic projection
 * (`support/headless-terminal.ts`).
 *
 * What this lane owns that the component specs beside it do not: those assert
 * on `ink-testing-library`'s `lastFrame()` string, which is the text Ink
 * *intended* to write with `patchConsole` disabled and a non-TTY stream. These
 * checkpoints assert on what a terminal *shows* after parsing the real byte
 * stream — wrapping at the actual width, cursor placement, scrollback
 * committed through the `console.log` path `scrollback/commit.ts` depends on,
 * and the SGR attributes of every cell. The pty smoke
 * (`@deepseek-ai/dsh-tui-runtime`'s `pty-smoke.client.spec.ts`) stays the
 * end-to-end evidence over a real pty and a real client tree; this lane is the
 * wide, cheap, keyless state matrix over the renderer itself.
 *
 * **Size matrix.** Every checkpoint is recorded at 80 and 120 columns. The
 * renderer's only width-dependent behavior is line wrapping — the composer
 * computes its own wrap budget from `stdout.columns` minus its prefix
 * (`input/layout.ts`), and Ink's Yoga layout wraps every other `<Text>` at the
 * terminal width — so two widths that straddle the fixture text's own length
 * are what make the pair load-bearing: the long lines below are sized to wrap
 * at 80 and fit at 120. The deleted pi-tui suite recorded five widths because
 * that renderer also switched layout *shape* by width (narrow/wide compaction
 * surfaces, paged dialogs); this renderer has no such breakpoint, so further
 * widths would re-record the same wrap rule.
 *
 * **Snapshot modes.** `replay` (the keyless default) compares against the
 * committed expected outputs. `refresh` rewrites them from the current
 * renderer. `record` behaves identically to `refresh` here: this lane calls no
 * model and reads no key, so it has nothing extra to capture.
 */

import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PendingWait } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ConversationNode, ConversationSnapshot, PendingInteraction, RunningToolCall,
} from '@deepseek-ai/dsh-client-runtime/client'
import { buildActivityModel } from '../src/activity/activity-model.ts'
import { App } from '../src/components/App.tsx'
import { commitToScrollback } from '../src/scrollback/commit.ts'
import { renderClosedNodeLines } from '../src/transcript/node-lines.ts'
import { HeadlessTerminal, mountInk, type MountedInk, type TerminalSnapshotOptions } from './support/headless-terminal.ts'

const SNAPSHOTS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'snapshots')
const SNAPSHOT_MODE = process.env.DSH_SNAPSHOT ?? 'replay'
const WRITE_BACK = SNAPSHOT_MODE === 'refresh' || SNAPSHOT_MODE === 'record'

/** Every interaction state this lane pins, at every width in {@link WIDTHS}. */
const CHECKPOINTS = [
  'composer-ready',
  'streaming-partial',
  'tool-running',
  'approval-prompt',
  'question-prompt',
  'scrollback-after-answer',
  'multiline-composer',
] as const

/** The size matrix: one width whose fixture lines wrap, one where they fit (see the module doc). */
const WIDTHS = [80, 120] as const

/** Terminal height for every checkpoint; feeds the activity model's streaming-tail budget. */
const ROWS = 24

/**
 * Frozen wall clock. `ToolRunningRow` picks its spinner frame from
 * `Date.now() - startedAtMs` and re-reads the clock on its own 80ms interval,
 * so a live clock would make every running-tool checkpoint a race against
 * which frame was current when the projection was taken. Freezing is safe for
 * Ink's own throttling: `waitUntilRenderFlush()` flushes its render and log
 * timers explicitly rather than waiting for the clock to advance.
 */
const FROZEN_NOW = Date.UTC(2026, 7, 15, 9, 0, 0)

/** Three spinner intervals before {@link FROZEN_NOW}: pins the fourth frame, not the first. */
const TOOL_STARTED_AT = FROZEN_NOW - 240

/** 104 columns of prose: wraps at 80, fits at 120. */
const LONG_ANSWER_LINE = 'The renderer paints this answer line long enough that eighty columns must wrap it and one twenty need not.'

/** 96 columns of prompt text: wraps at 80 (behind the composer prefix), fits at 120. */
const LONG_PROMPT_LINE = 'record the checkpoint matrix at both widths so the wrap rule itself is part of the fixture'

type Checkpoint = typeof CHECKPOINTS[number]
type Width = typeof WIDTHS[number]
type QueuedMessage = ConversationSnapshot['queue'][number]

const observed = new Set<string>()

/**
 * Brand an opaque id literal for a fixture. These ids address nothing — no
 * host, no log, no wire — so the fixture states the identity it wants and
 * skips the owning package's constructor rather than depending on it. Typed
 * `never` so one function serves every branded id position: the same `as
 * never` escape the package's component specs already use, named once here
 * instead of repeated at each call site.
 * @param value - the literal to brand.
 * @returns the value, assignable to whatever branded type the call site expects.
 */
function fixtureId(value: string): never {
  return value as unknown as never
}

/** A `respond` carrier that fails loudly: no checkpoint answers a pending interaction. */
function neverResponds(): Promise<never> {
  return Promise.reject(new Error('snapshot checkpoints render pending interactions; they never answer them'))
}

function baseSnapshot(overrides: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
  return {
    sessionId: fixtureId('snapshot-session'),
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
    composerPhase: 'active',
    removed: false,
    openState: 'open',
    openError: null,
    hasMore: false,
    loadingOlder: false,
    promptError: null,
    blank: false,
    lastAgentError: null,
    ...overrides,
  }
}

function runningCall(callId: string, title: string, kind: 'execute' | 'read'): RunningToolCall {
  return {
    callId,
    name: callId,
    argsRaw: '{}',
    turn: 1,
    step: 1,
    time: TOOL_STARTED_AT,
    callView: { card: 'generic', title, kind },
    subCalls: [],
  }
}

function queuedMessage(): QueuedMessage {
  return {
    id: fixtureId('queued-1'),
    messageId: fixtureId('queued-1'),
    placement: 'queued',
    content: [{ type: 'text', text: 'and then run the gates' }],
    preview: 'and then run the gates',
    text: 'and then run the gates',
  }
}

function approvalPending(): PendingInteraction {
  return new PendingWait(
    'approval',
    fixtureId('rpc-approval-1'),
    fixtureId('snapshot-session'),
    {
      approvalId: fixtureId('approval-1'),
      toolName: 'bash',
      reason: 'writes packages/tui/ink-ui/tests/snapshots and re-records every committed expected output',
    },
    neverResponds,
  )
}

function questionPending(): PendingInteraction {
  return new PendingWait(
    'question',
    fixtureId('rpc-question-1'),
    fixtureId('snapshot-session'),
    {
      questions: [{
        id: 'width-matrix',
        question: 'Which widths should the checkpoint matrix record?',
        options: [
          { label: '80 and 120 columns' },
          { label: '80 columns only' },
          { label: 'every width the pi-tui suite used' },
        ],
      }],
    },
    neverResponds,
  )
}

function userNode(text: string): ConversationNode {
  return { kind: 'user', seq: 1, time: FROZEN_NOW, content: [{ type: 'text', text }], source: { kind: 'user' } }
}

function assistantNode(text: string): ConversationNode {
  return { kind: 'assistant', seq: 2, time: FROZEN_NOW, turn: 1, step: 1, blocks: [{ kind: 'text', text }] }
}

/**
 * The root element for one snapshot, built exactly the way `render.ts` builds
 * it: an activity model derived from a conversation snapshot, plus the two
 * control callbacks.
 * @param snapshot - the conversation state to render.
 * @param onSubmit - composer submit sink (a checkpoint that types uses it to assert delivery).
 * @returns the root element.
 */
function appElement(snapshot: ConversationSnapshot, onSubmit: (text: string) => void = () => {}): React.ReactElement {
  return React.createElement(App, {
    activity: buildActivityModel(snapshot, ROWS),
    onSubmit,
    onCancel: () => {},
  })
}

function fixtureName(name: Checkpoint, columns: Width): string {
  return `${name}-${columns}col`
}

/**
 * Assert one checkpoint: theme invariance first (a violation is a defect in
 * the render, not a stale expected output), then the cell-level projection
 * against its committed fixture.
 * @param name - the checkpoint being pinned.
 * @param columns - the width this recording is for.
 * @param terminal - the terminal holding the painted state.
 * @param options - projection options (scrollback inclusion).
 */
async function checkpoint(
  name: Checkpoint,
  columns: Width,
  terminal: HeadlessTerminal,
  options: TerminalSnapshotOptions = {},
): Promise<void> {
  observed.add(fixtureName(name, columns))
  const snapshot = await terminal.snapshot(options)
  expect(
    terminal.themeViolations(),
    `${fixtureName(name, columns)} must stay theme-agnostic: no truecolor, no palette entry above 15, no explicit background`,
  ).toEqual([])
  expect(terminal.frames, `${fixtureName(name, columns)} must have painted at least one synchronized frame`).toBeGreaterThan(0)
  const path = join(SNAPSHOTS_DIR, `${fixtureName(name, columns)}.expected.txt`)
  if (WRITE_BACK) {
    await mkdir(SNAPSHOTS_DIR, { recursive: true })
    await writeFile(path, snapshot)
  }
  await expect(snapshot).toMatchFileSnapshot(path)
}

/** Mount one checkpoint's renderer over a fresh terminal of the given width. */
async function mount(columns: Width, element: React.ReactElement): Promise<{ terminal: HeadlessTerminal; ink: MountedInk }> {
  const terminal = new HeadlessTerminal(columns, ROWS)
  const ink = await mountInk(terminal, element)
  return { terminal, ink }
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW)
})

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(async () => {
  const expected = WIDTHS.flatMap(columns => CHECKPOINTS.map(name => fixtureName(name, columns))).sort()
  expect([...observed].sort(), 'every checkpoint in the matrix must be recorded').toEqual(expected)
  const files = (await readdir(SNAPSHOTS_DIR)).sort()
  expect(files, 'the snapshots directory must hold exactly the matrix, with no orphan left behind').toEqual(
    expected.map(name => `${name}.expected.txt`),
  )
})

for (const columns of WIDTHS) {
  describe(`renderer checkpoints at ${columns} columns`, () => {
    it('pins the ready composer of an idle session', async () => {
      const { terminal, ink } = await mount(columns, appElement(baseSnapshot()))
      await checkpoint('composer-ready', columns, terminal)
      await ink.dispose()
    })

    it('pins a mid-stream turn: reasoning, partial answer, and a running tool spinner', async () => {
      const snapshot = baseSnapshot({
        running: true,
        partial: {
          turn: 1,
          step: 1,
          blocks: [
            { kind: 'reasoning', text: 'Deciding which widths the matrix needs.' },
            { kind: 'text', text: LONG_ANSWER_LINE },
          ],
        },
        runningCalls: [runningCall('bash', 'pnpm exec vitest run packages/tui/ink-ui', 'execute')],
      })
      const { terminal, ink } = await mount(columns, appElement(snapshot))
      // The recorded `cursor` row reflects `ActivityRegion`'s measured offset
      // (`measureElement`, `ActivityRegion.tsx`) added to the composer's own
      // row: this checkpoint has a reasoning line, a wrapped answer line, and
      // a running-tool row above the composer, so the cursor lands below all
      // three, not on the frame's first row.
      await checkpoint('streaming-partial', columns, terminal)
      await ink.dispose()
    })

    it('pins two running tool rows and the queued-input hint', async () => {
      const snapshot = baseSnapshot({
        running: true,
        runningCalls: [
          runningCall('bash', 'pnpm exec tsx scripts/run-oxlint.ts packages/tui/ink-ui --config .oxlintrc.json', 'execute'),
          runningCall('read', 'packages/tui/ink-ui/src/components/ActivityRegion.tsx', 'read'),
        ],
        queue: [queuedMessage()],
      })
      const { terminal, ink } = await mount(columns, appElement(snapshot))
      await checkpoint('tool-running', columns, terminal)
      await ink.dispose()
    })

    it('pins a focused approval prompt with the composer released', async () => {
      const { terminal, ink } = await mount(columns, appElement(baseSnapshot({ pending: [approvalPending()] })))
      await checkpoint('approval-prompt', columns, terminal)
      await ink.dispose()
    })

    it('pins a focused question prompt with its option list', async () => {
      const { terminal, ink } = await mount(columns, appElement(baseSnapshot({ pending: [questionPending()] })))
      await checkpoint('question-prompt', columns, terminal)
      await ink.dispose()
    })

    it('pins scrollback after a submitted prompt is answered', async () => {
      const submitted: string[] = []
      const idle = baseSnapshot()
      const { terminal, ink } = await mount(columns, appElement(idle, text => submitted.push(text)))

      await ink.type('re-record the checkpoint matrix\r')
      expect(submitted, 'Enter must submit the composer before anything commits').toEqual(['re-record the checkpoint matrix'])

      // The commit loop `render.ts` runs for every newly settled node: render
      // the closed node's lines, then push them through the patched console
      // (the Q1-proven scrollback path), then repaint the live region.
      for (const node of [userNode('re-record the checkpoint matrix'), assistantNode(LONG_ANSWER_LINE)]) {
        commitToScrollback(renderClosedNodeLines(node))
      }
      await ink.rerender(appElement(idle))

      await checkpoint('scrollback-after-answer', columns, terminal, { includeScrollback: true })
      await ink.dispose()
    })

    it('pins a multi-line draft in the composer', async () => {
      const { terminal, ink } = await mount(columns, appElement(baseSnapshot()))
      // One chunk carrying a line break, the shape a paste or a fast burst
      // delivers: `foldKeypressEvent` splits it, so the composer holds two
      // logical lines and the first one wraps at the narrow width.
      await ink.type(`${LONG_PROMPT_LINE}\nthen report the matrix`)
      await checkpoint('multiline-composer', columns, terminal)
      await ink.dispose()
    })
  })
}
