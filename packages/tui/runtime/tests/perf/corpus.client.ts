/**
 * Deterministic synthetic long-session corpus generator for the terminal
 * application's performance gate. The official-terminal-application Agent
 * Note requires the gate to run "on a regenerated benchmark corpus (a
 * scripted long session of at least 100k events; the historical 196k-event
 * corpus was never committed)" — this module is that generator.
 *
 * The output is one JSONL session log in the shipped on-disk logical format
 * (`packages/session/session-persistence-jsonl/README.md`): a first
 * `{ type: 'session', … }` header line followed by one `SessionEvent` JSON
 * per line, `seq` contiguous from 0. The header carries `{{sessionId}}` and
 * `{{cwd}}` placeholders, exactly like `apps/web/tests/scaffold.ts`'s own
 * seed fixtures, so one generated corpus can be materialized into any
 * persistence root under any session id.
 *
 * **Determinism is a contract**: every value that would otherwise vary run to
 * run — message ids (the real `createMessage` uses `crypto.randomUUID()`),
 * timestamps (`Date.now()`), and the shape mix — is drawn from a seeded
 * `mulberry32` stream, so two generations with the same
 * {@link CorpusOptions} produce byte-identical text. `corpus-generation.perf.client.ts`
 * pins that with a two-run SHA-256 comparison.
 *
 * **No `@deepseek-ai/dsh-session` import, deliberately.** That package's root
 * merges `sessions: SessionStore` (a Host service) into every consumer's
 * cordis `Context`, and this file belongs to the CLIENT typecheck aggregate
 * (`tsconfig.client.json`), where `sessions` is already merged as the Client
 * `ISessions` — importing it would poison the program exactly as
 * `packages/tui/runtime/src/index.ts`'s module doc describes. Its
 * client-safe `/types` subpath would work but is not a declared dependency of
 * this package. The rows below are therefore typed structurally here, and
 * validated where it actually matters: the benchmarks materialize this
 * corpus through the REAL JSONL backend and resume it through the REAL host
 * tree, so a wrong row shape fails the run rather than passing a stale type.
 * @module @deepseek-ai/dsh-tui-runtime/tests/perf/corpus
 */

/** Fixed wall-clock origin for every generated corpus (never `Date.now()` — see the module doc). */
const EPOCH_MS = 1_767_225_600_000

/** Provider/model tags stamped on every synthetic assistant message and request header. */
const PROVIDER = 'deepseek-official'
/** Model id stamped on every synthetic assistant message and request header. */
const MODEL = 'deepseek-v4-flash'

/**
 * Tool names drawn for synthetic tool cards. Real shipped tool names (`bash`,
 * `read`, `edit`, … — see `packages/bundle/base/cordis.patch.yml`'s tool
 * rows), not invented ones, so a resumed corpus exercises the host's real
 * per-event `view` attachment and the renderer's real card kinds rather than
 * the unknown-tool generic fallback.
 */
const TOOL_NAMES = ['bash', 'read', 'edit', 'write', 'grep', 'glob', 'web_search', 'web_fetch'] as const

/** The tool whose calls carry a user-facing question (the question shape in a transcript). */
const QUESTION_TOOL = 'ask_user_question'

/** JSON value union for synthetic event payloads (structural — see the module doc). */
type Json = string | number | boolean | null | Json[] | { [key: string]: Json | undefined }

/** One generated session-log row: a `SessionEvent` JSON object. */
export interface CorpusEvent {
  /** Event type — a member of the repository-wide `SessionEventMap` vocabulary. */
  readonly type: string
  /** Position in the append-only log; contiguous from 0 across the whole corpus. */
  readonly seq: number
  /** Deterministic event time in epoch milliseconds. */
  readonly time: number
  /** Type-specific payload. */
  readonly data: Record<string, Json | undefined>
  /** Surface intent, present only on the surface-eligible events that carry one. */
  readonly surfaceOp?: 'append'
  /** Seqs this surface event derives from (a `tool/result`'s originating `tool/call`). */
  readonly sourceEventSeqs?: number[]
}

/** Knobs for one corpus generation. */
export interface CorpusOptions {
  /** PRNG seed; the same seed and target always produce byte-identical output. */
  readonly seed: number
  /** Lower bound on generated events; generation stops at the first `turn/end` at or past it. */
  readonly targetEvents: number
}

/** Shape report for one generated corpus — the "语料形态说明" the gate reports beside its timings. */
export interface CorpusStats {
  /** Total events (excluding the header line). */
  readonly events: number
  /** Completed turns. */
  readonly turns: number
  /** Completed steps. */
  readonly steps: number
  /** `tool/call` events (one per tool card). */
  readonly toolCalls: number
  /** `tool/call` events naming {@link QUESTION_TOOL}. */
  readonly questionCalls: number
  /** `approval/asked`/`approval/decided` pairs. */
  readonly approvals: number
  /** `assistant/chunk` events (the delta stream — the dominant type in a real long session). */
  readonly chunks: number
  /** Per-type event counts, sorted by type. */
  readonly byType: Readonly<Record<string, number>>
  /** UTF-8 byte length of the generated JSONL text (header line included). */
  readonly bytes: number
}

/** One generated corpus: its JSONL text plus the shape report. */
export interface GeneratedCorpus {
  /** The JSONL text, header line first, ending in exactly one trailing newline. */
  readonly text: string
  /** Shape report (see {@link CorpusStats}). */
  readonly stats: CorpusStats
}

/**
 * `mulberry32` — a 32-bit seeded PRNG. Chosen over `Math.random` because the
 * corpus must be byte-reproducible, and over a crypto PRNG because
 * reproducibility, not unpredictability, is the requirement.
 * @param seed - the 32-bit seed.
 * @returns a function yielding the next float in `[0, 1)`.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

/** Deterministic drawing helpers over one seeded stream. */
class Draw {
  private readonly next: () => number

  /**
   * @param seed - PRNG seed for this stream.
   */
  constructor(seed: number) {
    this.next = mulberry32(seed)
  }

  /**
   * Draw an integer in `[min, max]`.
   * @param min - inclusive lower bound.
   * @param max - inclusive upper bound.
   * @returns the drawn integer.
   */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }

  /**
   * Draw one member of a non-empty list.
   * @param items - the candidates.
   * @returns the drawn member.
   */
  pick<T>(items: readonly T[]): T {
    // The bound is items.length - 1 and every caller passes a non-empty literal tuple.
    return items[this.int(0, items.length - 1)]!
  }

  /**
   * Draw a boolean true with the given probability.
   * @param probability - chance of `true`, in `[0, 1]`.
   * @returns the drawn boolean.
   */
  chance(probability: number): boolean {
    return this.next() < probability
  }

  /**
   * Draw a lowercase hex string of the requested length (message ids, call ids).
   * @param length - number of hex digits.
   * @returns the hex string.
   */
  hex(length: number): string {
    let out = ''
    while (out.length < length) out += this.int(0, 15).toString(16)
    return out
  }

  /**
   * Draw a UUID-shaped message id — the same shape `createMessage`'s
   * `crypto.randomUUID()` produces, minus the entropy this corpus must not have.
   * @returns the id.
   */
  messageId(): string {
    return `${this.hex(8)}-${this.hex(4)}-4${this.hex(3)}-a${this.hex(3)}-${this.hex(12)}`
  }
}

/** Filler vocabulary — mixed-script so wrapping and `string-width` behavior are exercised. */
const WORDS = [
  'analyze', 'refactor', 'the', 'terminal', 'renderer', 'scrollback', 'commit', 'window',
  '会话', '渲染', '延迟', '基准', '语料', '事件', 'p95', 'latency', 'resume', 'tail',
] as const

/**
 * Build a deterministic filler paragraph.
 * @param draw - the seeded stream.
 * @param words - number of words to emit.
 * @returns the paragraph text.
 */
function paragraph(draw: Draw, words: number): string {
  const parts: string[] = []
  for (let index = 0; index < words; index++) parts.push(draw.pick(WORDS))
  return parts.join(' ')
}

/**
 * Build a deterministic fenced code block (the long-assistant-text shape).
 * @param draw - the seeded stream.
 * @param lines - number of code lines.
 * @returns the fenced block.
 */
function fencedCode(draw: Draw, lines: number): string {
  const body: string[] = []
  for (let index = 0; index < lines; index++) {
    body.push(`const ${draw.pick(WORDS).replace(/[^a-z]/gu, 'x')}_${String(index)} = ${String(draw.int(0, 9_999))}`)
  }
  return `\n\n\`\`\`ts\n${body.join('\n')}\n\`\`\``
}

/** Mutable generation cursor shared by every emit helper. */
interface Cursor {
  seq: number
  time: number
}

/**
 * Deterministic corpus builder. Kept as a class so the seq/time cursor and
 * the per-type tally are owned in one place rather than threaded through
 * every emit helper as parameters.
 */
class CorpusBuilder {
  private readonly events: CorpusEvent[] = []
  private readonly tally = new Map<string, number>()
  private readonly cursor: Cursor = { seq: 0, time: EPOCH_MS }
  private toolCalls = 0
  private questionCalls = 0
  private approvals = 0
  private turns = 0
  private steps = 0

  /**
   * @param draw - the seeded stream every shape decision is drawn from.
   */
  constructor(private readonly draw: Draw) {}

  /** @returns the events generated so far. */
  get length(): number {
    return this.events.length
  }

  /**
   * Append one event, advancing the seq and the deterministic clock.
   * @param type - event type.
   * @param data - type-specific payload.
   * @param surface - surface intent for a surface-eligible event.
   * @returns the appended event's seq.
   */
  private emit(
    type: string,
    data: Record<string, Json | undefined>,
    surface?: { readonly surfaceOp: 'append'; readonly sourceEventSeqs?: number[] },
  ): number {
    const seq = this.cursor.seq
    this.cursor.seq += 1
    this.cursor.time += this.draw.int(1, 40)
    this.events.push({ type, seq, time: this.cursor.time, data, ...surface })
    this.tally.set(type, (this.tally.get(type) ?? 0) + 1)
    return seq
  }

  /**
   * Emit one user message (a surface `append`).
   * @param turn - the turn this message opens.
   */
  private emitUserMessage(turn: number): void {
    const long = this.draw.chance(0.15)
    this.emit('user/message', {
      id: this.draw.messageId(),
      role: 'user',
      source: { kind: 'user' },
      content: [{
        type: 'text',
        text: `[turn ${String(turn)}] ${paragraph(this.draw, long ? this.draw.int(60, 140) : this.draw.int(6, 24))}`,
      }],
    }, { surfaceOp: 'append' })
  }

  /**
   * Emit one `request/header` for a step.
   * @param turn - turn coordinate.
   * @param step - step coordinate.
   */
  private emitRequestHeader(turn: number, step: number): void {
    this.emit('request/header', {
      header: {
        config: { provider: PROVIDER, model: MODEL },
        system: `Synthetic performance system prompt (turn ${String(turn)}, step ${String(step)}).`,
      },
      reason: turn === 1 && step === 1 ? 'initial' : 'change',
    })
  }

  /**
   * Emit one delta run for a block: `block-start`, N deltas, `block-end`.
   * These `assistant/chunk` events are the dominant type in a real long
   * session (the historical 196k-event corpus averaged ~89 events per step)
   * and are what the JSONL backend's packed-chunk rows compress.
   * @param turn - turn coordinate.
   * @param step - step coordinate.
   * @param blockType - `'text'` or `'reasoning'`.
   * @param body - the full block text the deltas reconstruct.
   */
  private emitDeltaRun(turn: number, step: number, blockType: 'text' | 'reasoning', body: string): void {
    this.emit('assistant/chunk', { turn, step, chunk: { type: 'block-start', index: 0, blockType } })
    const deltaType = blockType === 'text' ? 'text-delta' : 'reasoning-delta'
    for (let offset = 0; offset < body.length; offset += 24) {
      this.emit('assistant/chunk', {
        turn,
        step,
        chunk: { type: deltaType, index: 0, text: body.slice(offset, offset + 24) },
      })
    }
    this.emit('assistant/chunk', {
      turn,
      step,
      chunk: { type: 'block-end', index: 0, block: { type: blockType, text: body } },
    })
  }

  /**
   * Emit one text-answer step: header, delta run, assistant message.
   * @param turn - turn coordinate.
   * @param step - step coordinate.
   */
  private emitTextStep(turn: number, step: number): void {
    this.emit('step/start', { turn, step })
    this.emitRequestHeader(turn, step)
    const shape = this.draw.int(0, 9)
    const body = shape === 0
      ? `${paragraph(this.draw, this.draw.int(180, 320))}${fencedCode(this.draw, this.draw.int(20, 60))}`
      : shape < 4
        ? paragraph(this.draw, this.draw.int(4, 14))
        : paragraph(this.draw, this.draw.int(40, 110))
    if (this.draw.chance(0.35)) this.emitDeltaRun(turn, step, 'reasoning', paragraph(this.draw, this.draw.int(20, 60)))
    this.emitDeltaRun(turn, step, 'text', body)
    this.emit('assistant/message', {
      turn,
      step,
      message: {
        id: this.draw.messageId(),
        role: 'assistant',
        source: { kind: 'model', provider: PROVIDER, model: MODEL },
        content: [{ type: 'text', text: body }],
      },
      usage: {
        inputTokens: 4_000 + turn * 7,
        outputTokens: Math.ceil(body.length / 4),
        cacheReadTokens: this.draw.int(0, 3_000),
      },
    }, { surfaceOp: 'append' })
    this.emit('step/end', { turn, step })
    this.steps += 1
  }

  /**
   * Emit one tool-dispatch step: header, an assistant message carrying tool
   * calls, the `tool/call` events, optional approval audit pairs, and the
   * matching `tool/result` surface events.
   * @param turn - turn coordinate.
   * @param step - step coordinate.
   */
  private emitToolStep(turn: number, step: number): void {
    this.emit('step/start', { turn, step })
    this.emitRequestHeader(turn, step)

    const callCount = this.draw.chance(0.2) ? this.draw.int(2, 5) : 1
    const calls = Array.from({ length: callCount }, (_, index) => {
      const isQuestion = this.draw.chance(0.06)
      const name = isQuestion ? QUESTION_TOOL : this.draw.pick(TOOL_NAMES)
      return {
        callId: `perf-${String(turn)}-${String(step)}-${String(index)}-${this.draw.hex(6)}`,
        name,
        isQuestion,
        args: JSON.stringify(this.toolArguments(name, turn)),
      }
    })

    if (this.draw.chance(0.3)) {
      this.emitDeltaRun(turn, step, 'reasoning', paragraph(this.draw, this.draw.int(15, 45)))
    }
    this.emit('assistant/message', {
      turn,
      step,
      message: {
        id: this.draw.messageId(),
        role: 'assistant',
        source: { kind: 'model', provider: PROVIDER, model: MODEL },
        content: calls.map(call => ({
          type: 'tool-call' as const,
          id: call.callId,
          name: call.name,
          arguments: call.args,
        })),
      },
      usage: { inputTokens: 6_000 + turn * 7, outputTokens: 300, cacheReadTokens: this.draw.int(0, 4_000) },
    }, { surfaceOp: 'append' })

    const callSeqs = calls.map(call => this.emit('tool/call', {
      turn,
      step,
      callId: call.callId,
      name: call.name,
      arguments: call.args,
    }))

    for (const [index, call] of calls.entries()) {
      this.toolCalls += 1
      if (call.isQuestion) this.questionCalls += 1
      if (!call.isQuestion && this.draw.chance(0.18)) {
        const approvalId = `approval-${String(turn)}-${String(step)}-${String(index)}`
        this.emit('approval/asked', {
          id: approvalId,
          toolName: call.name,
          callId: call.callId,
          reason: 'synthetic sandbox escalation for the performance corpus',
        })
        this.emit('approval/decided', {
          id: approvalId,
          outcome: this.draw.chance(0.85) ? 'allowed-once' : 'rejected',
        })
        this.approvals += 1
      }
      const isError = this.draw.chance(0.07)
      // callSeqs is built from the same `calls` array, index for index.
      const sourceSeq = callSeqs[index]!
      this.emit('tool/result', {
        turn,
        step,
        message: {
          id: this.draw.messageId(),
          role: 'user',
          source: { kind: 'tool', callId: call.callId },
          content: [{
            type: 'tool-result',
            toolCallId: call.callId,
            isError,
            content: [{ type: 'text', text: this.toolResultText(call.name, isError) }],
          }],
        },
        ...isError ? { error: { name: 'ToolError', code: 'synthetic-failure' } } : {},
      }, { surfaceOp: 'append', sourceEventSeqs: [sourceSeq] })
    }

    this.emit('step/end', { turn, step })
    this.steps += 1
  }

  /**
   * Build deterministic arguments for one tool call.
   * @param name - tool name.
   * @param turn - turn coordinate (keeps arguments varying across the corpus).
   * @returns the arguments object.
   */
  private toolArguments(name: string, turn: number): Record<string, Json> {
    switch (name) {
      case 'bash':
        return { command: `rg -n "${draWord(this.draw)}" packages/tui --glob '!**/lib/**'`, description: 'search the terminal packages' }
      case 'read':
        return { file_path: `/repo/packages/tui/ink-ui/src/${draWord(this.draw)}.ts`, offset: this.draw.int(1, 200), limit: 120 }
      case 'edit':
        return {
          file_path: `/repo/packages/tui/runtime/src/${draWord(this.draw)}.ts`,
          old_string: paragraph(this.draw, 6),
          new_string: paragraph(this.draw, 8),
        }
      case 'write':
        return { file_path: `/repo/tmp/${draWord(this.draw)}-${String(turn)}.md`, content: paragraph(this.draw, this.draw.int(20, 80)) }
      case 'grep':
        return { pattern: draWord(this.draw), path: 'packages', output_mode: 'content' }
      case 'glob':
        return { pattern: `packages/**/${draWord(this.draw)}*.ts` }
      case 'web_search':
        return { query: `${draWord(this.draw)} terminal renderer benchmark` }
      case 'web_fetch':
        return { url: `https://example.invalid/${draWord(this.draw)}/${String(turn)}`, prompt: 'summarize' }
      case QUESTION_TOOL:
        return {
          question: `Which rendering path should turn ${String(turn)} take?`,
          options: [{ label: 'commit to scrollback' }, { label: 'keep in the live region' }],
        }
      // Backstop: only reachable if TOOL_NAMES gains a member without a case.
      default:
        return { note: paragraph(this.draw, 8) }
    }
  }

  /**
   * Build deterministic result text for one tool call.
   * @param name - tool name.
   * @param isError - whether this result is a failure.
   * @returns the result text.
   */
  private toolResultText(name: string, isError: boolean): string {
    if (isError) return `${name}: synthetic failure — ${paragraph(this.draw, this.draw.int(4, 12))}`
    const lines = this.draw.chance(0.25) ? this.draw.int(40, 160) : this.draw.int(2, 12)
    const body: string[] = []
    for (let index = 0; index < lines; index++) body.push(`${String(index).padStart(4, ' ')}| ${paragraph(this.draw, this.draw.int(4, 12))}`)
    return body.join('\n')
  }

  /** Emit one complete turn, from `turn/start` to `turn/end`. */
  emitTurn(): void {
    const turn = this.turns + 1
    this.emit('turn/start', { turn })
    if (turn === 1) {
      this.emit('session/title', {
        title: 'Synthetic terminal performance corpus',
        messageSeqs: [],
        source: { kind: 'user' },
      })
    }
    this.emitUserMessage(turn)
    if (turn % 9 === 0) {
      this.emit('request/context', { provider: PROVIDER, model: MODEL, contextWindow: 128_000 })
    }

    const stepCount = this.draw.int(1, 4)
    for (let step = 1; step <= stepCount; step++) {
      if (step < stepCount || this.draw.chance(0.15)) this.emitToolStep(turn, step)
      else this.emitTextStep(turn, step)
    }

    if (turn % 13 === 0) {
      this.emit('todo/write', {
        todos: Array.from({ length: this.draw.int(2, 6) }, (_, index) => ({
          content: paragraph(this.draw, 6),
          status: index === 0 ? 'in_progress' : 'pending',
        })),
      })
    }
    this.emit('turn/end', { turn, reason: { kind: 'completed' } })
    this.turns += 1
  }

  /**
   * Serialize the corpus to JSONL text with the header line prepended.
   * @returns the JSONL text and its shape report.
   */
  finish(): GeneratedCorpus {
    const header = {
      type: 'session',
      version: 0,
      id: '{{sessionId}}',
      createdAt: EPOCH_MS,
      cwd: '{{cwd}}',
      delegationDepth: 0,
    }
    const text = `${[JSON.stringify(header), ...this.events.map(event => JSON.stringify(event))].join('\n')}\n`
    const byType: Record<string, number> = {}
    for (const type of [...this.tally.keys()].sort()) byType[type] = this.tally.get(type) ?? 0
    return {
      text,
      stats: {
        events: this.events.length,
        turns: this.turns,
        steps: this.steps,
        toolCalls: this.toolCalls,
        questionCalls: this.questionCalls,
        approvals: this.approvals,
        chunks: this.tally.get('assistant/chunk') ?? 0,
        byType,
        bytes: Buffer.byteLength(text, 'utf8'),
      },
    }
  }
}

/**
 * Draw one identifier-safe filler word.
 * @param draw - the seeded stream.
 * @returns an ASCII-only word (the mixed-script vocabulary members are folded to `x`).
 */
function draWord(draw: Draw): string {
  const word = draw.pick(WORDS).replace(/[^a-z_]/gu, '')
  return word === '' ? 'sample' : word
}

/**
 * Generate one synthetic long-session corpus.
 * @param options - seed and event-count target (see {@link CorpusOptions}).
 * @returns the JSONL text and its shape report.
 */
export function generateCorpus(options: CorpusOptions): GeneratedCorpus {
  const builder = new CorpusBuilder(new Draw(options.seed))
  // Turn-granular: a corpus must end on `turn/end` (an open final turn would
  // be rewritten by resume's crash repair on first open, which would make the
  // fixture's own bytes non-reproducible after one benchmark run).
  while (builder.length < options.targetEvents) builder.emitTurn()
  return builder.finish()
}

/**
 * Substitute a materialization target into a generated corpus's header
 * placeholders (the same `{{sessionId}}`/`{{cwd}}` protocol
 * `apps/web/tests/scaffold.ts` uses for its own seed fixtures).
 * @param text - generated corpus text.
 * @param sessionId - the session id to stamp.
 * @param cwd - the workspace directory to stamp.
 * @returns the realized JSONL text.
 */
export function realizeCorpus(text: string, sessionId: string, cwd: string): string {
  return text.replaceAll('{{sessionId}}', sessionId).replaceAll('{{cwd}}', cwd)
}

/**
 * Split a realized corpus into its header line and its event rows.
 * @param text - realized JSONL text (see {@link realizeCorpus}).
 * @returns the parsed header object and the parsed events.
 */
export function parseCorpus(text: string): { header: Record<string, unknown>; events: CorpusEvent[] } {
  const lines = text.split('\n').filter(line => line !== '')
  const [headerLine, ...eventLines] = lines
  if (headerLine === undefined) throw new Error('parseCorpus: empty corpus text')
  return {
    header: JSON.parse(headerLine) as Record<string, unknown>,
    events: eventLines.map(line => JSON.parse(line) as CorpusEvent),
  }
}
