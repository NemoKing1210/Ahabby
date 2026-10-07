import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Download, ExternalLink, Info, RefreshCw, Store } from 'lucide-react'

import type { HubEntry } from '@/shared/bindings/HubEntry'
import type { HubSource } from '@/shared/bindings/HubSource'
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
 * What a right click on an entry offers: the two things the card's own body and button do, plus
 * the four the card has no room for — where it comes from, where it lives, its id, and asking the
 * collection about it again.
 *
 * Items only appear when they lead somewhere: no link, no "open"; nothing installable, no
 * "install"; nothing to re-read, no refresh. The trigger is the whole card, so the menu also opens
 * from the keyboard's context-menu key.
 */
export function HubContextMenu({
  entry,
  source,
  onView,
  onInstall,
  onRefresh,
  refreshing,
  children,
}: {
  entry: HubEntry
  source: HubSource
  onView: (entry: HubEntry) => void
  onInstall: (entry: HubEntry) => void
  /** Re-reads the collection this entry comes from, ignoring the cached answer. */
  onRefresh: (entry: HubEntry) => void
  refreshing?: boolean
  children: ReactNode
}) {
  const { t } = useTranslation()
  const browser = useBrowser()
  const page = entry.homepage ?? entry.repository
  const collection = source.homepage ?? source.docs

  const copyId = () => {
    void copyText(entry.id).then((ok) => {
      if (ok) toast.success(t('toast.copied'), entry.id)
    })
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent aria-label={entry.title ?? entry.name}>
        <ContextMenuLabel>{entry.title ?? entry.name}</ContextMenuLabel>

        <ContextMenuItem onSelect={() => onView(entry)}>
          <Info aria-hidden />
          {t('hub.view')}
        </ContextMenuItem>
        <ContextMenuItem disabled={!entry.installable} onSelect={() => onInstall(entry)}>
          <Download aria-hidden />
          {t('hub.install')}
        </ContextMenuItem>

        {page || collection ? <ContextMenuSeparator /> : null}
        {page ? (
          <ContextMenuItem onSelect={() => browser.open(page)}>
            <ExternalLink aria-hidden />
            {t('hub.entryPage')}
          </ContextMenuItem>
        ) : null}
        {collection ? (
          <ContextMenuItem onSelect={() => browser.open(collection)}>
            <Store aria-hidden />
            {t('hub.openSource')}
          </ContextMenuItem>
        ) : null}

        <ContextMenuSeparator />
        <ContextMenuItem onSelect={copyId}>
          <Copy aria-hidden />
          {t('hub.copyId')}
        </ContextMenuItem>
        <ContextMenuItem disabled={refreshing} onSelect={() => onRefresh(entry)}>
          <RefreshCw aria-hidden />
          {t('hub.refreshEntry')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
