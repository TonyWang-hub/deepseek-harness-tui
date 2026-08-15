/**
 * SGR styling for scrollback-committed plain strings. Committing a closed
 * step goes through `console.log()` (the Q1 finding — see
 * `tests/q1-scrollback-commit.poc.ts`), which means the committed text is a
 * plain string, never an Ink `<Text>` element: this module is the one place
 * that applies color to that plain string, so a scrollback line and an Ink
 * JSX line (which instead sets `<Text color>`) never pick divergent colors
 * for the same semantic role. `chalk` is already a transitive Ink dependency
 * (Ink builds every JSX color through it); this package depends on it
 * directly rather than reaching through Ink's own module graph.
 * @module @deepseek-ai/dsh-tui-ink-ui/ansi/style
 */

import chalk from 'chalk'

/** Named style roles used across the transcript and tool cards. */
export const style = {
  /** A card or role title (e.g. a tool-call header, a role prefix). */
  title: (text: string): string => chalk.bold(text),
  /** De-emphasized chrome (footers, hints, timestamps). */
  dim: (text: string): string => chalk.dim(text),
  /** A user-message role prefix. */
  userRole: (text: string): string => chalk.cyan.bold(text),
  /** An assistant-message role prefix. */
  assistantRole: (text: string): string => chalk.magenta.bold(text),
  /** An error or failure indicator (a non-zero exit code, a tool error, a turn error). */
  error: (text: string): string => chalk.red.bold(text),
  /** A diff's added line. */
  diffAdd: (text: string): string => chalk.green(text),
  /** A diff's removed line. */
  diffDel: (text: string): string => chalk.red(text),
  /** A diff's unchanged context line. */
  diffContext: (text: string): string => chalk.dim(text),
} as const
