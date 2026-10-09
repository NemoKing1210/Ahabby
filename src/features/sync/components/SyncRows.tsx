import {
  BookOpen,
  Bot,
  Brain,
  Eye,
  FileCog,
  FileText,
  GitCompare,
  KeyRound,
  MessageSquare,
  Puzzle,
  Scale,
  Server,
  SquareTerminal,
  Upload,
  Webhook,
  type LucideIcon,
} from 'lucide-react'
import type { ComponentPropsWithRef } from 'react'
import { useTranslation } from 'react-i18next'

import type { RemoteItem } from '@/shared/bindings/RemoteItem'
import type { SyncItem } from '@/shared/bindings/SyncItem'
import type { SyncKind } from '@/shared/bindings/SyncKind'
import { cn } from '@/shared/lib/cn'
import { formatBytes, formatRelative } from '@/shared/lib/format'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Tooltip } from '@/shared/ui/Tooltip'

import { statusTone } from '../lib/labels'

/**
 * A plain checkbox.
 *
 * Ahabby's own UI kit has none — every other multi-select in the app is a card that toggles —
 * so this is the browser control, painted with the design tokens rather than a component that
 * would have to be kept in step with them.
 */
export function SelectBox({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      aria-label={label}
      className="border-border-strong bg-surface focus-visible:outline-ring size-4 shrink-0 cursor-pointer rounded-[0.25rem] border accent-[var(--color-accent)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
    />
  )
}

/** The icon tile of a kind — the first thing that tells two rows apart. */
const KIND_ICONS: Record<SyncKind, LucideIcon> = {
  config: FileCog,
  env: KeyRound,
  skill: BookOpen,
  mcp: Server,
  instruction: FileText,
  command: SquareTerminal,
  subagent: Bot,
  hook: Webhook,
  rule: Scale,
  prompt: MessageSquare,
  memory: Brain,
  other: FileText,
  extension: Puzzle,
}

function KindTile({ kind }: { kind: SyncKind }) {
  const Icon = KIND_ICONS[kind] ?? FileText
  return (
    <span
      aria-hidden
      className="bg-surface-2 text-muted inline-flex size-8 shrink-0 items-center justify-center rounded-lg"
    >
      <Icon className="size-4" />
    </span>
  )
}

/** What a row is, in words: the icon tile says it in a glance, the label says it for sure. */
function KindLabel({ kind }: { kind: SyncKind }) {
  const { t } = useTranslation()
  return <span className="text-faint text-[0.6875rem]">{t(`sync.kind.${kind}`)}</span>
}

/**
 * One item of this machine: where it lives, whether it changed, and the action that saves it.
 *
 * The checkbox is only rendered when the caller takes a selection (the Settings library);
 * the agent page shows a plain "Save" per row instead.
 */
export function SyncItemRow({
  item,
  selected,
  onSelect,
  onSave,
  onView,
  onCompare,
  busy = false,
  className,
  ...rest
}: {
  item: SyncItem
  selected?: boolean
  onSelect?: (selected: boolean) => void
  onSave: () => void
  /** Opens the file reader. */
  onView?: () => void
  /** Opens the comparison; offered only for an item that has a cloud copy. */
  onCompare?: () => void
  busy?: boolean
} & Omit<ComponentPropsWithRef<'div'>, 'onSelect'>) {
  const { t } = useTranslation()
  const size = formatBytes(item.sizeBytes)

  return (
    <div
      className={cn(
        'border-border bg-surface hover:bg-surface-2/60 ease-warm flex items-center gap-3 rounded-xl border p-3 transition-colors duration-150',
        className,
      )}
      {...rest}
    >
      {onSelect ? (
        <SelectBox checked={selected ?? false} onChange={onSelect} label={item.label} />
      ) : (
        <KindTile kind={item.kind} />
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{item.label}</span>
          <Badge tone={statusTone(item.status)}>{t(`sync.status.${item.status}`)}</Badge>
          {item.hasSecrets ? <Badge tone="warning">{t('sync.secretBadge')}</Badge> : null}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <KindLabel kind={item.kind} />
          <span className="text-faint truncate font-mono text-[0.6875rem]">
            {item.relativePath}
          </span>
        </div>
      </div>

      <div className="text-faint hidden shrink-0 flex-col text-right text-[0.6875rem] tabular-nums sm:flex">
        {/* A directory is reported by the scan as one entry; its file count is only known once
            the payload is built, so a folder says so instead of claiming to hold one file. */}
        <span>
          {item.isDirectory ? t('sync.folder') : t('sync.filesShort', { count: item.files })}
        </span>
        {size ? <span>{size}</span> : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {onView ? (
          <Tooltip content={t('sync.view')}>
            <Button variant="ghost" size="icon-sm" aria-label={t('sync.view')} onClick={onView}>
              <Eye className="size-3.5" aria-hidden />
            </Button>
          </Tooltip>
        ) : null}
        {onCompare ? (
          <Tooltip content={t('sync.compare')}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('sync.compare')}
              onClick={onCompare}
            >
              <GitCompare className="size-3.5" aria-hidden />
            </Button>
          </Tooltip>
        ) : null}
        <Button variant="secondary" size="sm" loading={busy} onClick={onSave}>
          <Upload className="size-3.5" aria-hidden />
          {item.remoteId ? t('sync.saveAgain') : t('sync.save')}
        </Button>
      </div>
    </div>
  )
}

/**
 * One copy in the cloud: what it holds, when it was written, and the two things a user does with
 * it — restore it somewhere, or delete it.
 */
export function RemoteItemRow({
  item,
  localName,
  onPreview,
  onDelete,
  onView,
  onCompare,
  selected,
  onSelect,
  busy = false,
  className,
  ...rest
}: {
  item: RemoteItem
  /** The local item of the same key, when this machine has one — its status is what is shown. */
  localName?: string
  onPreview: () => void
  onDelete: () => void
  /** Opens the file reader on the cloud copy. */
  onView?: () => void
  /** Opens the comparison; offered only when this machine has the item too. */
  onCompare?: () => void
  /** Rendered only when the caller takes a selection; the tile takes its place otherwise. */
  selected?: boolean
  onSelect?: (selected: boolean) => void
  busy?: boolean
} & Omit<ComponentPropsWithRef<'div'>, 'onSelect'>) {
  const { t, i18n } = useTranslation()
  const size = formatBytes(item.sizeBytes)
  const updated = formatRelative(item.updatedAtMs, i18n.language)

  return (
    <div
      className={cn(
        'border-border bg-surface hover:bg-surface-2/60 ease-warm flex items-center gap-3 rounded-xl border p-3 transition-colors duration-150',
        className,
      )}
      {...rest}
    >
      {onSelect ? (
        <SelectBox
          checked={selected ?? false}
          onChange={onSelect}
          label={item.label || item.name}
        />
      ) : (
        <KindTile kind={item.kind} />
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{item.label || item.name}</span>
          {item.hasSecrets ? <Badge tone="warning">{t('sync.secretBadge')}</Badge> : null}
          {localName ? <Badge tone="success">{t('sync.status.synced')}</Badge> : null}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <KindLabel kind={item.kind} />
          <span className="text-faint truncate font-mono text-[0.6875rem]">
            {item.relativePath || item.key}
          </span>
        </div>
      </div>

      <div className="text-faint hidden shrink-0 flex-col text-right text-[0.6875rem] tabular-nums sm:flex">
        <span>{t('sync.filesShort', { count: item.files })}</span>
        {size ? <span>{size}</span> : null}
        {updated ? <span>{updated}</span> : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {onView ? (
          <Tooltip content={t('sync.view')}>
            <Button variant="ghost" size="icon-sm" aria-label={t('sync.view')} onClick={onView}>
              <Eye className="size-3.5" aria-hidden />
            </Button>
          </Tooltip>
        ) : null}
        {onCompare ? (
          <Tooltip content={t('sync.compare')}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('sync.compare')}
              onClick={onCompare}
            >
              <GitCompare className="size-3.5" aria-hidden />
            </Button>
          </Tooltip>
        ) : null}
        <Button variant="ghost" size="sm" onClick={onPreview} loading={busy}>
          {t('sync.restore')}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onDelete}
          aria-label={t('sync.delete')}
          className="text-danger-fg hover:bg-danger/10"
        >
          <span aria-hidden className="text-base leading-none">
            ×
          </span>
        </Button>
      </div>
    </div>
  )
}
