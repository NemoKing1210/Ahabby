import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Download, ExternalLink, Eye, GitCompare, Trash2 } from 'lucide-react'

import type { RemoteItem } from '@/shared/bindings/RemoteItem'
import { copyText } from '@/shared/lib/clipboard'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/shared/ui/ContextMenu'
import { toast } from '@/shared/ui/Toast'

import { useBrowser } from '@/features/browser/context'

/**
 * What a right click on a cloud copy offers: restoring it (which always goes through its
 * preview), opening it on GitHub, copying what it was, and removing it from the cloud.
 *
 * There is no "reveal in file manager" here on purpose — a remote copy has no path on this
 * machine until it is restored.
 */
export function SyncRemoteContextMenu({
  item,
  onRestore,
  onDelete,
  onView,
  onCompare,
  busy = false,
  children,
}: {
  item: RemoteItem
  /** Opens the restore preview; the copy is written only from there. */
  onRestore: () => void
  onDelete: () => void
  /** Opens the file reader on the cloud copy. */
  onView?: () => void
  /** Only offered when this machine holds the item too. */
  onCompare?: () => void
  busy?: boolean
  children: ReactNode
}) {
  const { t } = useTranslation()
  const browser = useBrowser()
  const target = item.relativePath || item.key
  const uri = item.uri

  const copyPath = () => {
    void copyText(target).then((ok) => {
      if (ok) toast.success(t('toast.copied'), target)
    })
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent aria-label={item.label || item.name}>
        <ContextMenuLabel>{item.label || item.name}</ContextMenuLabel>

        <ContextMenuItem disabled={busy} onSelect={onRestore}>
          <Download aria-hidden />
          {t('sync.restore')}
        </ContextMenuItem>

        {onView ? (
          <ContextMenuItem onSelect={onView}>
            <Eye aria-hidden />
            {t('sync.view')}
          </ContextMenuItem>
        ) : null}

        {onCompare ? (
          <ContextMenuItem onSelect={onCompare}>
            <GitCompare aria-hidden />
            {t('sync.compare')}
          </ContextMenuItem>
        ) : null}

        {uri ? (
          <ContextMenuItem onSelect={() => browser.open(uri)}>
            <ExternalLink aria-hidden />
            {t('sync.openInGitHub')}
          </ContextMenuItem>
        ) : null}

        <ContextMenuSeparator />
        <ContextMenuItem onSelect={copyPath}>
          <Copy aria-hidden />
          {t('common.copy')}
        </ContextMenuItem>

        <ContextMenuSeparator />
        <ContextMenuItem destructive onSelect={onDelete}>
          <Trash2 aria-hidden />
          {t('sync.delete')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
