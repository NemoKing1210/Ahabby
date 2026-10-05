import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { ROOT } from '../lib/versions.mjs'

// Version discipline is cheap to check; lint, types and tests stay in CI.
const result = spawnSync(process.execPath, [join(ROOT, 'scripts', 'check-versions.mjs')], {
  cwd: ROOT,
  stdio: 'inherit',
})

if (result.status !== 0) {
  console.error('\n✖ Fix the version mismatch before pushing (`npm run version:patch`).\n')
  process.exit(1)
}
