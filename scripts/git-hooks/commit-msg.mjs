import { readFileSync } from 'node:fs'
import { validateCommitMessage, TYPES } from '../lib/commits.mjs'

const file = process.argv[2]
if (!file) {
  process.exit(0)
}

const { ok, reason } = validateCommitMessage(readFileSync(file, 'utf8'))

if (!ok) {
  console.error(`\n✖ Invalid commit message: ${reason}\n`)
  console.error('  Use Conventional Commits: <type>(<scope>)!: <description>')
  console.error(`  types: ${TYPES.join(', ')}`)
  console.error('  example: feat(agents): show the detected version on the card')
  console.error('  rules: CONTRIBUTING.md → Commits\n')
  process.exit(1)
}
