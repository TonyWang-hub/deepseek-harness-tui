/**
 * Sanitize a tool's captured terminal output before it passes through a
 * terminal card: strip OSC (Operating System Command), DCS (Device Control
 * String), APC/PM/SOS string sequences, and CSI cursor/mode-control
 * sequences, while keeping SGR (`\x1b[...m`, the color/style sequence) intact
 * — the design consequence the official-terminal-application Agent Note's
 * "Rendering" section states verbatim ("Terminal tool output is sanitized
 * (OSC, DCS, and cursor-control sequences stripped) before passthrough").
 *
 * A tool's captured output is a subprocess/wire boundary this renderer does
 * not otherwise trust: an OSC 8 hyperlink, a cursor-hide/bracketed-paste mode
 * change, or a title-bar OSC sequence from an arbitrary command must never
 * reach the terminal driving THIS application's own state — only the color
 * the same output already carries is worth keeping.
 * @module @deepseek-ai/dsh-tui-ink-ui/ansi/sanitize-terminal
 */

/** OSC: `ESC ]` ... terminated by BEL (`\x07`) or ST (`ESC \`). Covers title-bar and hyperlink (OSC 8) sequences. */
const OSC_PATTERN = /\x1b\][\s\S]*?(?:\x07|\x1b\\)/g

/** DCS/APC/PM/SOS: `ESC` followed by `P`/`_`/`^`/`X`, terminated by ST (`ESC \`). */
const STRING_SEQUENCE_PATTERN = /\x1b[P_^X][\s\S]*?\x1b\\/g

/**
 * CSI: `ESC [` + parameter bytes (`0-9;:<=>?`) + intermediate bytes (space
 * through `/`) + one final byte (`@` through `~`). SGR's final byte is `m`;
 * every other final byte (cursor movement, screen/line erase, DEC private
 * modes like `?25` cursor visibility or `?2004` bracketed paste, scroll
 * regions, …) is cursor/mode control and is dropped.
 */
const CSI_PATTERN = /\x1b\[[0-?]*[ -/]*([@-~])/g

/** Two-byte charset-designation escapes (`ESC ( B`, `ESC ) 0`, …). */
const CHARSET_DESIGNATION_PATTERN = /\x1b[()][A-Za-z0-9]/g

/** Common single-byte-argument ESC sequences: index/reverse-index, save/restore cursor, reset. */
const SINGLE_BYTE_ESC_PATTERN = /\x1b[0-9=><cDEHM]/g

/**
 * Any stray `ESC` byte left after the patterns above. A negative lookahead
 * excludes an ESC that still opens a SURVIVING SGR sequence (`CSI_PATTERN`
 * above deliberately leaves those intact, ESC included) — without it, this
 * blanket cleanup would strip the very SGR sequences this module exists to
 * keep, one step after `CSI_PATTERN` decided to preserve them.
 */
const STRAY_ESC_PATTERN = /\x1b(?!\[[0-9;:]*m)/g

/**
 * C0 control characters other than tab (`\x09`), line feed (`\x0a`),
 * carriage return (`\x0d`), and ESC (`\x1b`, 0x1B — inside the otherwise
 * contiguous 0x0E-0x1F range, so it is carved out here: `STRAY_ESC_PATTERN`
 * above already decided which ESC bytes to keep, and this pattern must not
 * re-strip them).
 */
const OTHER_C0_CONTROL_PATTERN = /[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f]/g

/**
 * Strip OSC/DCS/APC/PM/SOS and CSI cursor/mode-control sequences from
 * captured terminal output, keeping SGR color/style sequences, tabs, and
 * newlines. Any stray `ESC` byte left after the specific patterns above
 * (an escape sequence this function does not recognize) is dropped too,
 * rather than passed through incomplete — an unrecognized partial escape is
 * exactly the shape a hostile or truncated capture could exploit.
 * @param raw - captured command output (stdout+stderr as the tool combined them).
 * @returns the same text with only SGR sequences, tabs, and newlines surviving as control content.
 */
export function sanitizeTerminalOutput(raw: string): string {
  let text = raw
  text = text.replaceAll(OSC_PATTERN, '')
  text = text.replaceAll(STRING_SEQUENCE_PATTERN, '')
  text = text.replaceAll(CSI_PATTERN, (match, finalByte: string) => (finalByte === 'm' ? match : ''))
  text = text.replaceAll(CHARSET_DESIGNATION_PATTERN, '')
  text = text.replaceAll(SINGLE_BYTE_ESC_PATTERN, '')
  text = text.replaceAll(STRAY_ESC_PATTERN, '')
  text = text.replaceAll(OTHER_C0_CONTROL_PATTERN, '')
  return text
}
