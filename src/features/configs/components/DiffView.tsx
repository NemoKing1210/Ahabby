import { useTranslation } from 'react-i18next'

import { cn } from '@/shared/lib/cn'

/**
 * Unified diff renderer.
 *
 * Deliberately not CodeMirror: a diff is read, not edited, and per-line colouring is the
 * clearest way to show what a write would change.
 */
function lineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'text-faint'
  if (line.startsWith('@@')) return 'text-accent-strong'
  if (line.startsWith('+'))
    return 'bg-[color-mix(in_oklab,var(--color-success)_12%,transparent)] text-success-fg'
  if (line.startsWith('-'))
    return 'bg-[color-mix(in_oklab,var(--color-danger)_10%,transparent)] text-danger-fg'
  return 'text-muted'
}

export function DiffView({ unified, className }: { unified: string; className?: string }) {
  const { t } = useTranslation()
  const lines = unified.length > 0 ? unified.replace(/\n$/, '').split('\n') : []

  return (
    <div className={cn('border-border bg-surface overflow-hidden rounded-lg border', className)}>
      <div className="border-border text-faint border-b px-3 py-1.5 text-[11px] tracking-wide uppercase">
        {t('editor.diff')}
      </div>
      <div className="max-h-[45vh] overflow-auto font-mono text-[12px] leading-relaxed">
        {lines.length === 0 ? (
          <p className="text-muted px-3 py-3">{t('editor.noChanges')}</p>
        ) : (
          lines.map((line, index) => (
            <div key={index} className={cn('px-3 whitespace-pre-wrap', lineClass(line))}>
              {line.length > 0 ? line : ' '}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
