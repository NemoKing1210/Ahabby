import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { git } from '../lib/git.mjs'
import { ROOT } from '../lib/versions.mjs'

const PRETTIER_EXTENSIONS = /\.(js|mjs|cjs|ts|tsx|jsx|json|jsonc|md|markdown|yml|yaml|css|html)$/
const LINT_EXTENSIONS = /\.(js|mjs|cjs|ts|tsx|jsx)$/
const IGNORED = [
  'package-lock.json',
  'src/shared/bindings/',
  'dist/',
  'node_modules/',
  'src-tauri/target/',
  'src-tauri/gen/',
  'coverage/',
]

const staged = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
  .stdout.split('\n')
  .filter(Boolean)
  .filter((file) => !IGNORED.some((prefix) => file === prefix || file.startsWith(prefix)))

const prettierFiles = staged.filter((file) => PRETTIER_EXTENSIONS.test(file))
const lintFiles = staged.filter((file) => LINT_EXTENSIONS.test(file) && file.startsWith('src/'))

function run(bin, args) {
  const result = spawnSync(process.execPath, [join(ROOT, 'node_modules', ...bin), ...args], {
    cwd: ROOT,
    stdio: 'inherit',
  })
  return result.status === 0
}

if (
  prettierFiles.length > 0 &&
  !run(['prettier', 'bin', 'prettier.cjs'], ['--check', ...prettierFiles])
) {
  console.error(
    '\n✖ Prettier found unformatted staged files. Run `npm run format` and stage the result.\n',
  )
  process.exit(1)
}

if (lintFiles.length > 0 && !run(['eslint', 'bin', 'eslint.js'], lintFiles)) {
  console.error('\n✖ ESLint found problems in staged files. Fix them and stage the result.\n')
  process.exit(1)
}
