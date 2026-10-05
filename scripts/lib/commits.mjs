// Conventional Commits v1.0.0 rules shared by the git hooks and CI.
// Docs: CONTRIBUTING.md → Commits. Keep .cursor/rules/commits.mdc in sync.

export const TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
]

export const MAX_HEADER_LENGTH = 100

// type(scope)!: description — scope and the breaking-change mark are optional.
const HEADER = /^([a-z]+)(?:\(([^()\s]+)\))?(!)?: (.+)$/
const SCOPE = /^[a-z0-9._/-]+$/
// Commits that must not be rewritten and are accepted as-is.
const SKIP = /^(Merge |Revert "|Revert |fixup! |squash! |amend! |Bump )/

export function subjectOf(message) {
  for (const line of message.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length > 0 && !trimmed.startsWith('#')) {
      return trimmed
    }
  }
  return ''
}

export function validateCommitMessage(message) {
  const subject = subjectOf(message)
  if (subject.length === 0) {
    return { ok: false, reason: 'commit message is empty' }
  }
  if (SKIP.test(subject)) {
    return { ok: true, skipped: true }
  }

  const match = subject.match(HEADER)
  if (!match) {
    return {
      ok: false,
      reason: `"${subject}" is not Conventional Commits — expected "type(scope): description"`,
    }
  }

  const [, type, scope, , description] = match
  if (!TYPES.includes(type)) {
    return { ok: false, reason: `unknown type "${type}" — use one of ${TYPES.join(', ')}` }
  }
  if (scope && !SCOPE.test(scope)) {
    return {
      ok: false,
      reason: `scope "${scope}" must be lowercase letters, digits, ".", "_", "/" or "-"`,
    }
  }
  if (subject.length > MAX_HEADER_LENGTH) {
    return {
      ok: false,
      reason: `subject is ${subject.length} characters, limit is ${MAX_HEADER_LENGTH}`,
    }
  }
  if (description.endsWith('.')) {
    return { ok: false, reason: 'subject must not end with a period' }
  }

  return { ok: true }
}

export function validateCommitMessages(messages) {
  return messages.map((message, index) => ({ index, message, ...validateCommitMessage(message) }))
}
