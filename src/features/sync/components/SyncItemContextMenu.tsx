import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, ExternalLink, Eye, FolderOpen, GitCompare, Trash2, Upload } from 'lucide-react'

import { ipc } from '@/shared/api/ipc'
import type { SyncItem } from '@/shared/bindings/SyncItem'
import { copyText } from '@/shared/lib/clipboard'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/shared/ui/ContextMenu'
import { toast, toastAppError } from '@/shared/ui/Toast'

import { useBrowser } from '@/features/browser/context'

/**
 * What a right click on a local item offers: the row's own Save, the two path actions a row has
 * no room for, and the two things that only make sense once a copy exists in the cloud —
 * previewing it, opening it on GitHub, or removing it.
 *
 * Each item appears only when the screen wired a handler, so a menu is never a dead end. The
 * trigger is the row itself, which is also what makes the keyboard context-menu key work.
 */
export function SyncItemContextMenu({
  item,
  onSave,
  onView,
  onCompare,
  onDeleteRemote,
  busy = false,
  children,
}: {
  item: SyncItem
  onSave: () => void
  /** Opens the file reader. */
  onView?: () => void
  /** Only offered for an item that already has a cloud copy. */
  onCompare?: () => void
  /** Only offered for an item that already has a cloud copy. */
  onDeleteRemote?: (remoteId: string) => void
  busy?: boolean
  children: ReactNode
}) {
  const { t } = useTranslation()
  const browser = useBrowser()
  const remoteId = item.remoteId
  const remoteUri = item.remoteUri

  const copyPath = () => {
    void copyText(item.path).then((ok) => {
      if (ok) toast.success(t('toast.copied'), item.path)
    })
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent aria-label={item.label}>
        <ContextMenuLabel>{item.label}</ContextMenuLabel>

        <ContextMenuItem disabled={busy} onSelect={onSave}>
          <Upload aria-hidden />
          {remoteId ? t('sync.saveAgain') : t('sync.save')}
        </ContextMenuItem>

        {onView ? (
          <ContextMenuItem onSelect={onView}>
            <Eye aria-hidden />
            {t('sync.view')}
          </ContextMenuItem>
        ) : null}

        {remoteId && onCompare ? (
          <ContextMenuItem onSelect={onCompare}>
            <GitCompare aria-hidden />
            {t('sync.compare')}
          </ContextMenuItem>
        ) : null}

        {remoteUri ? (
          <ContextMenuItem onSelect={() => browser.open(remoteUri)}>
            <ExternalLink aria-hidden />
            {t('sync.openInGitHub')}
          </ContextMenuItem>
        ) : null}

        <ContextMenuSeparator />
        <ContextMenuItem onSelect={copyPath}>
          <Copy aria-hidden />
          {t('common.copy')}
        </ContextMenuItem>
        {item.exists ? (
          <ContextMenuItem onSelect={() => void ipc.revealPath(item.path).catch(toastAppError)}>
            <FolderOpen aria-hidden />
            {t('common.reveal')}
          </ContextMenuItem>
        ) : null}

        {remoteId && onDeleteRemote ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem destructive onSelect={() => onDeleteRemote(remoteId)}>
              <Trash2 aria-hidden />
              {t('sync.delete')}
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  )
}
