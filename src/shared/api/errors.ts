/**
 * Normalised errors.
 *
 * The backend serializes `AppError` as `{ code, message }`; commands are wrapped by Tauri,
 * so anything else (a network failure, a crash) shows up as an unknown error. Both are
 * normalised here, and the UI switches on `code` — never on the message text.
 */

export type AppErrorCode =
  | 'not_found'
  | 'io'
  | 'invalid_format'
  | 'stale_file'
  | 'command_not_allowed'
  | 'manager_unavailable'
  | 'no_install_method'
  | 'not_supported'
  | 'network'
  | 'job_not_found'
  | 'invalid_input'
  | 'invalid_manifest'
  | 'timeout'
  | 'other'
  | 'unknown'

export interface AppError {
  code: AppErrorCode
  message: string
}

const KNOWN_CODES: ReadonlySet<string> = new Set<AppErrorCode>([
  'not_found',
  'io',
  'invalid_format',
  'stale_file',
  'command_not_allowed',
  'manager_unavailable',
  'no_install_method',
  'not_supported',
  'network',
  'job_not_found',
  'invalid_input',
  'invalid_manifest',
  'timeout',
  'other',
])

export function toAppError(error: unknown): AppError {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as { code?: unknown; message?: unknown }
    const code =
      typeof candidate.code === 'string' && KNOWN_CODES.has(candidate.code)
        ? (candidate.code as AppErrorCode)
        : 'unknown'
    if (typeof candidate.message === 'string' && candidate.message.length > 0) {
      return { code, message: candidate.message }
    }
  }
  if (typeof error === 'string' && error.length > 0) {
    return { code: 'unknown', message: error }
  }
  return { code: 'unknown', message: 'unknown error' }
}

export function isStaleFileError(error: unknown): boolean {
  return toAppError(error).code === 'stale_file'
}
