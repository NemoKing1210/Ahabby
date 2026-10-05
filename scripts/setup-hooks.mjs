import { execFileSync } from 'node:child_process'
import { chmodSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './lib/versions.mjs'

const HOOKS = ['commit-msg', 'pre-commit', 'pre-push']

try {
  execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: ROOT, stdio: 'ignore' })
} catch {
  // Not a git checkout (tarball, CI cache). Nothing to wire up.
  process.exit(0)
}

execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: ROOT })

for (const hook of HOOKS) {
  try {
    chmodSync(join(ROOT, '.githooks', hook), 0o755)
  } catch {
    // Windows may not expose the executable bit; Git for Windows runs sh hooks anyway.
  }
}

console.log('Git hooks enabled: .githooks (commit-msg, pre-commit, pre-push)')
