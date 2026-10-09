import { AlignLeft, Columns2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { Tooltip } from '@/shared/ui/Tooltip'

import { buildDiff, toSplitRows, type DiffLine, type SplitRow } from '../lib/diffRows'

/**
 * Git-style comparison of two versions of a file.
 *
 * The line diff comes from `diff` (jsdiff); everything around it is painted with the app's own
 * tokens, so the view wears the current theme like the rest of the app. Split is the default —
 * a backup and the file it came from are read side by side — and unified is one click away.
 */

const TONES = {
  context: 'text-muted',
  add: 'bg-[color-mix(in_oklab,var(--color-success)_12%,transparent)] text-success-fg',
  remove: 'bg-[color-mix(in_oklab,var(--color-danger)_10%,transparent)] text-danger-fg',
  meta: 'text-faint',
} as const

const MARKER: Record<DiffLine['kind'], string> = {
  context: ' ',
  add: '+',
  remove: '-',
  meta: '',
}

/** The line number column; always rendered so both sides stay aligned. */
function Gutter({ value }: { value?: number }) {
  return (
    <span className="text-faint w-11 shrink-0 pr-2 text-right tabular-nums select-none">
      {value ?? ''}
    </span>
  )
}

/** One side of a split row, or the shaded filler that keeps the other side aligned. */
function Side({
  line,
  side,
  empty = false,
}: {
  line?: DiffLine
  side: 'left' | 'right'
  empty?: boolean
}) {
  if (empty || !line) {
    return <div className="bg-surface-2/60" aria-hidden />
  }
  return (
    <div className={cn('flex min-w-0 pe-2', TONES[line.kind])}>
      <Gutter value={side === 'left' ? line.oldNo : line.newNo} />
      <span className="min-w-0 flex-1 pe-3 break-words whitespace-pre-wrap">
        {line.text || '\u00a0'}
      </span>
    </div>
  )
}

function SplitLine({ row }: { row: SplitRow }) {
  if (row.kind === 'meta') {
    return (
      <div className="text-faint col-span-2 px-3 whitespace-pre">
        {(row.left?.text ?? '').trim() || '\u00a0'}
      </div>
    )
  }
  return (
    <>
      <Side line={row.left} side="left" empty={row.left === undefined} />
      <Side line={row.right} side="right" empty={row.right === undefined} />
    </>
  )
}

function UnifiedLine({ line }: { line: DiffLine }) {
  return (
    <div className={cn('flex min-w-0', TONES[line.kind])}>
      <Gutter value={line.oldNo} />
      <Gutter value={line.newNo} />
      <span className="w-4 shrink-0 text-center select-none">{MARKER[line.kind]}</span>
      <span className="min-w-0 flex-1 pe-3 break-words whitespace-pre-wrap">
        {line.text || '\u00a0'}
      </span>
    </div>
  )
}

export function BackupDiff({
  oldText,
  newText,
  leftLabel,
  rightLabel,
}: {
  oldText: string
  newText: string
  leftLabel: string
  rightLabel: string
}) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'split' | 'unified'>('split')
  const model = useMemo(() => buildDiff(oldText, newText), [oldText, newText])
  const empty = model.hunks.length === 0

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="text-faint flex min-w-0 items-baseline gap-2 text-[0.6875rem]">
          {model.hunks.length > 0 ? (
            <>
              <span className="text-success-fg">+{model.added}</span>
              <span className="text-danger-fg">-{model.removed}</span>
            </>
          ) : null}
        </div>
        <div className="ms-auto flex items-center gap-0.5">
          <Tooltip content={t('editor.sideBySide')}>
            <span className="inline-flex">
              <Button
                variant={mode === 'split' ? 'subtle' : 'ghost'}
                size="icon-sm"
                aria-label={t('editor.sideBySide')}
                aria-pressed={mode === 'split'}
                onClick={() => setMode('split')}
              >
                <Columns2 className="size-4" aria-hidden />
              </Button>
            </span>
          </Tooltip>
          <Tooltip content={t('editor.unified')}>
            <span className="inline-flex">
              <Button
                variant={mode === 'unified' ? 'subtle' : 'ghost'}
                size="icon-sm"
                aria-label={t('editor.unified')}
                aria-pressed={mode === 'unified'}
                onClick={() => setMode('unified')}
              >
                <AlignLeft className="size-4" aria-hidden />
              </Button>
            </span>
          </Tooltip>
        </div>
      </div>

      <div className="border-border bg-surface overflow-auto rounded-lg border font-mono text-[0.75rem] leading-relaxed">
        {empty ? (
          <p className="text-muted px-3 py-3">{t('editor.identical')}</p>
        ) : mode === 'unified' ? (
          <div>
            {model.hunks.map((hunk) => (
              <div key={hunk.header}>
                <div className="bg-surface-2 text-accent-strong px-3 whitespace-pre">
                  {hunk.header}
                </div>
                {hunk.lines.map((line, index) => (
                  <UnifiedLine key={index} line={line} />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div>
            <div className="bg-surface-2 text-faint sticky top-0 z-10 grid grid-cols-2 text-[0.6875rem] tracking-wide uppercase">
              <span className="truncate px-3 py-1">{leftLabel}</span>
              <span className="border-border truncate border-s px-3 py-1">{rightLabel}</span>
            </div>
            {model.hunks.map((hunk) => (
              <div key={hunk.header} className="grid grid-cols-2">
                <div className="bg-surface-2 text-accent-strong col-span-2 px-3 whitespace-pre">
                  {hunk.header}
                </div>
                {toSplitRows(hunk.lines).map((row, index) => (
                  <SplitLine key={index} row={row} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
