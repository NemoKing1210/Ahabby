import { structuredPatch } from 'diff'

/**
 * Turn two texts into git-shaped hunks for the comparison view.
 *
 * `diff` (jsdiff) computes the line diff; this module only reshapes the result so the renderer
 * never has to parse a patch: one place decides what a line number is and where a hunk starts.
 */

/** One line of a hunk with its git prefix already stripped. */
export interface DiffLine {
  kind: 'context' | 'add' | 'remove' | 'meta'
  /** 1-based line number in the old text; absent for an addition. */
  oldNo?: number
  /** 1-based line number in the new text; absent for a removal. */
  newNo?: number
  text: string
}

/** One hunk: its `@@ … @@` header plus the lines it holds. */
export interface DiffHunk {
  header: string
  lines: DiffLine[]
}

export interface DiffModel {
  hunks: DiffHunk[]
  added: number
  removed: number
}

/**
 * A row of the side-by-side view: one line from each side, paired where the change allows.
 * A `change` row has both sides, a `remove`/`add` row only one, a `meta` row neither.
 */
export interface SplitRow {
  kind: 'context' | 'change' | 'add' | 'remove' | 'meta'
  left?: DiffLine
  right?: DiffLine
}

/** How many unchanged lines surround each change before it is folded into a hunk. */
const CONTEXT = 3

/**
 * Git's header quirk: a hunk with zero lines on a side starts one line earlier than the range
 * suggests, so consumers can tell "no lines here" from "one line here".
 * https://www.artima.com/weblogs/viewpost.jsp?thread=164293
 */
function hunkHeader(hunk: {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
}): string {
  const oldStart = hunk.oldLines === 0 ? hunk.oldStart - 1 : hunk.oldStart
  const newStart = hunk.newLines === 0 ? hunk.newStart - 1 : hunk.newStart
  return `@@ -${oldStart},${hunk.oldLines} +${newStart},${hunk.newLines} @@`
}

/** Line diff of `oldText` → `newText`, newest-first order preserved from jsdiff. */
export function buildDiff(oldText: string, newText: string, context = CONTEXT): DiffModel {
  const patch = structuredPatch('backup', 'current', oldText, newText, undefined, undefined, {
    context,
  })

  let added = 0
  let removed = 0
  const hunks = patch.hunks.map((hunk) => {
    let oldNo = hunk.oldStart
    let newNo = hunk.newStart
    const lines: DiffLine[] = hunk.lines.map((raw) => {
      const prefix = raw[0]
      const text = raw.slice(1)
      if (prefix === '+') {
        added += 1
        return { kind: 'add', newNo: newNo++, text }
      }
      if (prefix === '-') {
        removed += 1
        return { kind: 'remove', oldNo: oldNo++, text }
      }
      if (prefix === '\\') return { kind: 'meta', text }
      return { kind: 'context', oldNo: oldNo++, newNo: newNo++, text }
    })
    return { header: hunkHeader(hunk), lines }
  })

  return { hunks, added, removed }
}

/**
 * Pair a hunk's lines into two columns.
 *
 * A run of removals followed by a run of additions is aligned index by index, so a changed line
 * sits next to its replacement rather than under it — the thing that makes a split diff worth
 * reading. A run with more of one side leaves the remainder as pure additions or removals.
 */
export function toSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (line === undefined) break

    if (line.kind === 'context') {
      rows.push({ kind: 'context', left: line, right: line })
      index += 1
      continue
    }
    if (line.kind === 'meta') {
      rows.push({ kind: 'meta', left: line, right: line })
      index += 1
      continue
    }

    const removals: DiffLine[] = []
    const additions: DiffLine[] = []
    while (index < lines.length) {
      const next = lines[index]
      if (next === undefined || (next.kind !== 'remove' && next.kind !== 'add')) break
      if (next.kind === 'remove') removals.push(next)
      else additions.push(next)
      index += 1
    }

    const length = Math.max(removals.length, additions.length)
    for (let offset = 0; offset < length; offset += 1) {
      const left = removals[offset]
      const right = additions[offset]
      if (left && right) rows.push({ kind: 'change', left, right })
      else if (left) rows.push({ kind: 'remove', left })
      else if (right) rows.push({ kind: 'add', right })
    }
  }

  return rows
}
