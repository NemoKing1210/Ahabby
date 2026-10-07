import { useTranslation } from 'react-i18next'
import { ExternalLink, Globe, Pencil, Power, RefreshCw, Trash2 } from 'lucide-react'

import type { Extension } from '@/shared/bindings/Extension'
import { AgentTag } from '@/shared/ui/AgentTag'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { KeyValue } from '@/shared/ui/Card'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Separator,
} from '@/shared/ui/Dialog'
import { PathRow } from '@/shared/ui/PathRow'
import { Timestamp } from '@/shared/ui/Timestamp'

import { useBrowser } from '@/features/browser/context'

/**
 * Everything Ahabby knows about one extension: where it comes from, where it lives, what it
 * ships, and the actions the card itself cannot fit.
 *
 * The dialog is mounted per extension and unmounted when it closes, so its content is always the
 * fresh row from the scan — a switched-off extension reopens showing the new state.
 */
export function ExtensionInfoDialog({
  extension,
  open,
  onOpenChange,
  onUpdate,
  onEdit,
  onRemove,
  onToggle,
  toggleBusy,
}: {
  extension: Extension | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdate?: (extension: Extension) => void
  onEdit?: (extension: Extension) => void
  onRemove?: (extension: Extension) => void
  onToggle?: (extension: Extension, enabled: boolean) => void
  toggleBusy?: boolean
}) {
  const { t } = useTranslation()
  const browser = useBrowser()

  if (!extension) return null

  const link = extension.homepage ?? extension.repository
  // A local module's source *is* its path; showing both would be the same string twice.
  const showSource = !extension.path || extension.source !== extension.path
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common.close')}
            </Button>
            {onEdit && extension.entryPath ? (
              <Button variant="secondary" onClick={() => onEdit(extension)}>
                <Pencil className="size-3.5" aria-hidden />
                {t('extensions.openSource')}
              </Button>
            ) : null}
            {onUpdate && extension.canUpdate ? (
              <Button variant="secondary" onClick={() => onUpdate(extension)}>
                <RefreshCw className="size-3.5" aria-hidden />
                {t('extensions.update')}
              </Button>
            ) : null}
            {onToggle && extension.canToggle ? (
              <Button
                variant="secondary"
                disabled={toggleBusy}
                onClick={() => onToggle(extension, !extension.enabled)}
              >
                <Power className="size-3.5" aria-hidden />
                {extension.enabled ? t('extensions.toggleOff') : t('extensions.toggleOn')}
              </Button>
            ) : null}
            {onRemove && extension.canRemove ? (
              <Button variant="ghost" onClick={() => onRemove(extension)}>
                <Trash2 className="size-3.5" aria-hidden />
                {t('extensions.remove')}
              </Button>
            ) : null}
          </>
        }
      >
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {extension.name}
            <Badge tone="outline">{t(`extensions.kind.${extension.kind}`)}</Badge>
            {extension.version ? <Badge tone="neutral">{extension.version}</Badge> : null}
            {!extension.enabled ? <Badge tone="neutral">{t('extensions.disabled')}</Badge> : null}
            {extension.unverified ? <Badge tone="warning">{t('agents.unverified')}</Badge> : null}
          </DialogTitle>
          <DialogDescription>
            {extension.description ?? t('extensions.noDescription')}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {showSource ? (
              <KeyValue label={t('extensions.source')} mono>
                {extension.source}
              </KeyValue>
            ) : null}
            {extension.manager ? (
              <KeyValue label={t('extensions.managerLabel')}>
                {t(`extensions.manager.${extension.manager}`)}
              </KeyValue>
            ) : null}
            {extension.author ? (
              <KeyValue label={t('extensions.author')}>{extension.author}</KeyValue>
            ) : null}
            {extension.license ? (
              <KeyValue label={t('extensions.license')}>{extension.license}</KeyValue>
            ) : null}
            <KeyValue label={t('extensions.owner')}>
              <AgentTag agent={extension.agent} />
            </KeyValue>
            <KeyValue label={t('extensions.updated')}>
              <Timestamp modifiedMs={extension.modifiedMs} />
            </KeyValue>
          </dl>

          {resources.length > 0 ? (
            <>
              <Separator />
              <div className="flex flex-col gap-1.5">
                <span className="text-faint text-[0.6875rem] tracking-wide uppercase">
                  {t('extensions.ships')}
                </span>
                <span className="text-foreground text-sm">{resources.join(' · ')}</span>
              </div>
            </>
          ) : null}

          <Separator />

          <div className="flex flex-col gap-3">
            {extension.path ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-faint text-[0.6875rem] tracking-wide uppercase">
                  {t('extensions.path')}
                </span>
                <PathRow path={extension.path} />
              </div>
            ) : (
              <p className="text-muted text-[0.8125rem]">
                {t(extension.kind === 'builtin' ? 'extensions.bundled' : 'extensions.notInstalled')}
              </p>
            )}

            {extension.entryPath && extension.entryPath !== extension.path ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-faint text-[0.6875rem] tracking-wide uppercase">
                  {t('extensions.entry')}
                </span>
                <PathRow path={extension.entryPath} />
              </div>
            ) : null}
          </div>

          {link ? (
            <Button
              variant="link"
              size="sm"
              className="self-start px-0"
              onClick={() => browser.open(link)}
            >
              {extension.homepage ? (
                <Globe className="size-3.5" aria-hidden />
              ) : (
                <ExternalLink className="size-3.5" aria-hidden />
              )}
              {extension.homepage ? t('extensions.website') : t('extensions.repository')}
            </Button>
          ) : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
