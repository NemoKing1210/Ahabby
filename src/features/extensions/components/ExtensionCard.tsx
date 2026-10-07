import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Boxes,
  FileCode2,
  GitBranch,
  Package,
  Pencil,
  RefreshCw,
  Trash2,
  type LucideIcon,
} from 'lucide-react'

import type { Extension } from '@/shared/bindings/Extension'
import type { ExtensionKind } from '@/shared/bindings/ExtensionKind'
import { cn } from '@/shared/lib/cn'
import { shortenPath } from '@/shared/lib/format'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Switch } from '@/shared/ui/Switch'
import { Timestamp } from '@/shared/ui/Timestamp'
import { Tooltip } from '@/shared/ui/Tooltip'

import { ExtensionContextMenu } from './ExtensionContextMenu'

const KIND_ICONS: Record<ExtensionKind, LucideIcon> = {
  package: Package,
  local: FileCode2,
  builtin: Boxes,
}

/** Where a package comes from, as a badge next to the kind. */
const MANAGER_ICONS = {
  npm: Package,
  git: GitBranch,
  local: FileCode2,
} as const

/**
 * One extension, in the same shape as a skill card: a tile, the name in the serif face, quiet
 * metadata, and the actions in their own column so a click there never opens the details.
 *
 * A package, a module the user dropped into the extensions directory and a built-in all render
 * through this one card — only the actions differ, and the backend decides which of them are
 * possible (`canUpdate`, `canRemove`, `canToggle`).
 */
export function ExtensionCard({
  extension,
  onInfo,
  onUpdate,
  onEdit,
  onRemove,
  onToggle,
  toggleBusy,
}: {
  extension: Extension
  /** Opens the details dialog; `undefined` disables the card body. */
  onInfo?: (extension: Extension) => void
  /** Offers the update of a package through the agent's own CLI. */
  onUpdate?: (extension: Extension) => void
  /** Offers opening the entry file of a local extension in the editor. */
  onEdit?: (extension: Extension) => void
  onRemove?: (extension: Extension) => void
  /** Only offered for a local extension Ahabby may switch off; the backend refuses the rest. */
  onToggle?: (extension: Extension, enabled: boolean) => void
  /** Disables this card's switch while its own mutation is in flight. */
  toggleBusy?: boolean
}) {
  const { t } = useTranslation()
  const KindIcon = KIND_ICONS[extension.kind]
  const ManagerIcon = extension.manager ? MANAGER_ICONS[extension.manager] : null
  const open = onInfo ? () => onInfo(extension) : undefined

  // The body is a div rather than a button: a button may not contain the block content the card
  // needs. Enter/Space keep it reachable from the keyboard.
  const activate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!open) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      open()
    }
  }

  const resources = [
    extension.resources.extensions > 0
      ? t('extensions.resources.extensions', { count: extension.resources.extensions })
      : null,
    extension.resources.skills > 0
      ? t('extensions.resources.skills', { count: extension.resources.skills })
      : null,
    extension.resources.prompts > 0
      ? t('extensions.resources.prompts', { count: extension.resources.prompts })
      : null,
    extension.resources.themes > 0
      ? t('extensions.resources.themes', { count: extension.resources.themes })
      : null,
  ].filter((part): part is string => part !== null)

  return (
    <ExtensionContextMenu
      extension={extension}
      onInfo={onInfo}
      onUpdate={onUpdate}
      onEdit={onEdit}
      onRemove={onRemove}
      onToggle={onToggle}
    >
      <Card
        className={cn(
          'group ease-warm hover:border-border-strong relative transition-[border-color,translate] duration-150 hover:-translate-y-px',
          !extension.enabled && 'border-dashed',
        )}
      >
        <div className="flex items-start gap-4 p-4">
          <div
            role="button"
            tabIndex={0}
            aria-label={extension.name}
            onClick={open}
            onKeyDown={activate}
            className="focus-visible:outline-ring flex min-w-0 flex-1 cursor-pointer items-start gap-4 rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <span
              aria-hidden
              className={cn(
                'border-border bg-surface-2 text-accent-strong inline-flex size-10 shrink-0 items-center justify-center rounded-lg border',
                !extension.enabled && 'opacity-60',
              )}
            >
              <KindIcon className="size-4" />
            </span>

            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    'group-hover:text-accent-strong font-serif text-[0.9375rem]',
                    extension.enabled ? 'text-foreground' : 'text-muted',
                  )}
                >
                  {extension.name}
                </span>
                <Badge tone="outline">{t(`extensions.kind.${extension.kind}`)}</Badge>
                {ManagerIcon && extension.manager ? (
                  <Badge tone="neutral">
                    <ManagerIcon className="size-3" aria-hidden />
                    {t(`extensions.manager.${extension.manager}`)}
                  </Badge>
                ) : null}
                {extension.version ? <Badge tone="neutral">{extension.version}</Badge> : null}
                {!extension.enabled ? (
                  <Badge tone="neutral">{t('extensions.disabled')}</Badge>
                ) : null}
                {extension.unverified ? (
                  <Badge tone="warning">{t('agents.unverified')}</Badge>
                ) : null}
              </div>

              {extension.description ? (
                <p className="text-muted max-w-prose text-[0.8125rem]">{extension.description}</p>
              ) : null}

              <div className="text-faint flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-[0.75rem]">
                <code className="font-mono">
                  {shortenPath(extension.path ?? extension.source, 4)}
                </code>
                {resources.length > 0 ? <span>{resources.join(' · ')}</span> : null}
                <Timestamp modifiedMs={extension.modifiedMs} />
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {onToggle && extension.canToggle ? (
              <Tooltip content={t('extensions.switchHint')}>
                <span className="inline-flex">
                  <Switch
                    checked={extension.enabled}
                    disabled={toggleBusy}
                    onCheckedChange={(next) => onToggle(extension, next)}
                    aria-label={
                      extension.enabled ? t('extensions.toggleOff') : t('extensions.toggleOn')
                    }
                  />
                </span>
              </Tooltip>
            ) : null}
            {onUpdate && extension.canUpdate ? (
              <Tooltip content={t('extensions.update')}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('extensions.update')}
                  onClick={() => onUpdate(extension)}
                >
                  <RefreshCw className="size-3.5" />
                </Button>
              </Tooltip>
            ) : null}
            <Button variant="secondary" size="sm" onClick={open} disabled={!open}>
              {t('extensions.details')}
            </Button>
            {onEdit && extension.entryPath ? (
              <Tooltip content={t('configs.edit')}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('configs.edit')}
                  onClick={() => onEdit(extension)}
                >
                  <Pencil className="size-3.5" />
                </Button>
              </Tooltip>
            ) : null}
            {onRemove && extension.canRemove ? (
              <Tooltip content={t('extensions.remove')}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('extensions.remove')}
                  onClick={() => onRemove(extension)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </Tooltip>
            ) : null}
          </div>
        </div>
      </Card>
    </ExtensionContextMenu>
  )
}
