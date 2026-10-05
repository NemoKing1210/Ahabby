import { git } from './lib/git.mjs'
import { validateCommitMessages } from './lib/commits.mjs'

const range = process.argv[2] ?? 'main..HEAD'

const listed = git(['log', '-z', '--no-merges', '--format=%B', range], { allowFail: true })
if (!listed.ok) {
  console.error(`Could not read commits in "${range}". Pass a range, e.g. "main..HEAD".`)
  process.exit(1)
}

const messages = listed.stdout.split('\0').filter((message) => message.trim().length > 0)
const failures = validateCommitMessages(messages).filter((result) => !result.ok)

if (failures.length > 0) {
  console.error(`Invalid commit messages in ${range}:`)
  for (const failure of failures) {
    console.error(`  - ${failure.message.split('\n')[0]}`)
    console.error(`    ${failure.reason}`)
  }
  process.exit(1)
}

console.log(`${messages.length} commit message(s) in ${range} follow Conventional Commits`)
