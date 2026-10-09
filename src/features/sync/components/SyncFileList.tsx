import { useTranslation } from 'react-i18next'
import { Binary, FileText } from 'lucide-react'

import type { SyncFileStatus } from '@/shared/bindings/SyncFileStatus'
import { cn } from '@/shared/lib/cn'
import { formatBytes } from '@/shared/lib/format'
import { Badge } from '@/shared/ui/Badge'

/** One row of a file pane, whatever the pane is for. */
export interface SyncFileEntry {
  path: string
  sizeBytes: number
  binary: boolean
  /** Set by the compare pane; the viewer has nothing to say about it. */
  status?: SyncFileStatus
  /** `true` when the file was read only in part. */
  truncated?: boolean
}

/** The tone a comparison status is painted with. */
const STATUS_TONE: Record<SyncFileStatus, 'success' | 'warning' | 'accent' | 'danger' | 'neutral'> =
  {
    same: 'success',
    changed: 'warning',
    localOnly: 'accent',
    cloudOnly: 'danger',
    binary: 'neutral',
  }

/**
 * The files of one item, as a column of pickable rows.
 *
 * Shared by the viewer and the comparison so the two read the same way: a path, its size, and —
 * when the caller is comparing — how that file stands against the other side.
 */
export function SyncFileList({
  files,
  selected,
  onSelect,
  className,
}: {
  files: SyncFileEntry[]
  selected: string
  onSelect: (path: string) => void
  className?: string
}) {
  const { t } = useTranslation()

  return (
    <ul className={cn('flex flex-col gap-1', className)}>
      {files.map((file) => {
        // A file always has a size; `0` means the pane was not told one.
        const size = file.sizeBytes > 0 ? formatBytes(file.sizeBytes) : null
        const active = file.path === selected
        return (
          <li key={file.path}>
            <button
              type="button"
              aria-current={active}
              onClick={() => onSelect(file.path)}
              className={cn(
                'ease-warm flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors duration-150',
                active
                  ? 'border-border-strong bg-surface-2'
                  : 'hover:bg-surface-2/70 border-transparent',
              )}
            >
              {file.binary ? (
                <Binary className="text-faint size-3.5 shrink-0" aria-hidden />
              ) : (
                <FileText className="text-faint size-3.5 shrink-0" aria-hidden />
              )}
              <span className="min-w-0 flex-1 truncate font-mono text-[0.75rem]" title={file.path}>
                {file.path}
              </span>
              {file.truncated ? <Badge tone="neutral">{t('sync.fileCut')}</Badge> : null}
              {file.status ? (
                <Badge tone={STATUS_TONE[file.status]}>{t(`sync.fileStatus.${file.status}`)}</Badge>
              ) : null}
              {size ? (
                <span className="text-faint shrink-0 text-[0.6875rem] tabular-nums">{size}</span>
              ) : null}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
