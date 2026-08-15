/**
 * Pure spinner-frame selection for a running tool call row. Kept dependency-
 * and Ink-free so the animation math is testable without mounting a
 * component; {@link ToolRunningRow} calls {@link spinnerFrameAt} with the
 * elapsed time it already tracks.
 * @module @deepseek-ai/dsh-tui-ink-ui/spinner
 */

/** Braille-dot spinner frames (the same family most terminal spinners use). */
export const SPINNER_FRAMES: readonly string[] = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/** Milliseconds each spinner frame is shown before advancing to the next. */
export const SPINNER_FRAME_INTERVAL_MS = 80

/**
 * Select the spinner frame for a given elapsed duration. Negative input
 * (a clock skew or a not-yet-started call) clamps to the first frame rather
 * than throwing — a cosmetic animation index is never worth failing a render.
 * @param elapsedMs - milliseconds since the running call (or the spinner) started.
 * @returns one of {@link SPINNER_FRAMES}.
 */
export function spinnerFrameAt(elapsedMs: number): string {
  const safeElapsed = elapsedMs > 0 ? elapsedMs : 0
  const index = Math.floor(safeElapsed / SPINNER_FRAME_INTERVAL_MS) % SPINNER_FRAMES.length
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- index is a modulo of a non-empty readonly array
  return SPINNER_FRAMES[index]!
}
