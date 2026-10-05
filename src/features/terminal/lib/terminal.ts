/**
 * Constants shared by the terminal feature.
 */

/**
 * Id of Ahabby's own terminal in `Settings::terminal` and in the picker the backend returns.
 * Must match `platform::terminals::BUILTIN_ID`.
 */
export const BUILTIN_TERMINAL_ID = 'builtin'

/** The command a session runs, shortened for a tooltip — the tooltip is not a shell. */
export function shortenCommand(command: string, max = 120): string {
  return command.length <= max ? command : `${command.slice(0, max - 1)}…`
}
