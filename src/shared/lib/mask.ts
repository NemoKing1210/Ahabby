/**
 * Secret detection, mirroring `domain::secrets` on the Rust side.
 *
 * The backend already redacts values before they cross the IPC boundary; this module exists
 * so the UI can decide *when to offer* a reveal control and how to render a value a user
 * explicitly asked to see. The two implementations are kept in sync by
 * `src/shared/lib/mask.test.ts`.
 */

const SECRET_HINTS = [
  'token',
  'secret',
  'password',
  'passwd',
  'passphrase',
  'apikey',
  'apisecret',
  'privatekey',
  'accesskey',
  'secretkey',
  'authorization',
  'authheader',
  'bearer',
  'credential',
  'clientsecret',
  'sessionkey',
  'cookie',
  'webhookurl',
  'webhook',
  'dsn',
  'connectionstring',
]

export function isSecretKey(key: string): boolean {
  const normalized = key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
  if (normalized.length === 0) return false
  if (normalized === 'path' || normalized === 'keypath' || normalized === 'publickey') return false
  return SECRET_HINTS.some((hint) => normalized.includes(hint))
}

export function maskValue(value: string): string {
  if (value.length === 0) return ''
  if (value.length <= 8) return '•'.repeat(Math.max(value.length, 4))
  return `${value.slice(0, 3)}${'•'.repeat(6)}${value.slice(-2)}`
}
