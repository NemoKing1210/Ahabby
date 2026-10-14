import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Link2,
  Square,
} from 'lucide-react'

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
 * What a right click on a source card offers: the actions its own strip carries — fold it away,
 * open the collection, take everything it shows — plus the two the strip has no room for, the link
 * and the id.
 *
 * Items only appear when they lead somewhere: no link, no "open"; nothing selectable, no batch
 * actions. The trigger is the source's own strip, never the collection's cards — an entry inside the
 * body keeps its own menu — so the two never fight over one right click.
 */
export function HubSourceContextMenu({
  source,
  collapsed,
  link,
  selectable,
  allSelected,
  installingAll,
  onToggleCollapsed,
  onSelectAll,
  onDeselectAll,
  onInstallAll,
  children,
}: {
  source: HubSource
  collapsed: boolean
  /** The collection's own address, when it declares one. */
  link: string | null
  /** Skills of this source on screen that can be selected. */
  selectable: number
  /** Whether every selectable skill is already in the selection. */
  allSelected: boolean
  installingAll?: boolean
  onToggleCollapsed: () => void
  onSelectAll: () => void
  onDeselectAll: () => void
  onInstallAll: () => void
  children: ReactNode
}) {
  const { t } = useTranslation()
  const browser = useBrowser()
  const toggleLabel = collapsed
    ? t('hub.expandSource', { name: source.name })
    : t('hub.collapseSource', { name: source.name })
  const docs = source.docs && source.docs !== source.homepage ? source.docs : null

  const copyLink = () => {
    if (!link) return
    void copyText(link).then((ok) => {
      if (ok) toast.success(t('toast.copied'), link)
    })
  }
  const copyId = () => {
    void copyText(source.id).then((ok) => {
      if (ok) toast.success(t('toast.copied'), source.id)
    })
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent aria-label={source.name}>
        <ContextMenuLabel>{source.name}</ContextMenuLabel>

        <ContextMenuItem onSelect={onToggleCollapsed}>
          {collapsed ? <ChevronRight aria-hidden /> : <ChevronDown aria-hidden />}
          {toggleLabel}
        </ContextMenuItem>

        {link ? (
          <ContextMenuItem onSelect={() => browser.open(link)}>
            <ExternalLink aria-hidden />
            {t('hub.openSource')}
          </ContextMenuItem>
        ) : null}
        {docs ? (
          <ContextMenuItem onSelect={() => browser.open(docs)}>
            <FileText aria-hidden />
            {t('hub.docs')}
          </ContextMenuItem>
        ) : null}

        {selectable > 0 ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={allSelected ? onDeselectAll : onSelectAll}>
              {allSelected ? <Square aria-hidden /> : <CheckSquare aria-hidden />}
              {allSelected
                ? t('hub.deselectAll', { count: selectable })
                : t('hub.selectAll', { count: selectable })}
            </ContextMenuItem>
            <ContextMenuItem disabled={installingAll} onSelect={onInstallAll}>
              <Download aria-hidden />
              {t('hub.installAll', { count: selectable })}
            </ContextMenuItem>
          </>
        ) : null}

        <ContextMenuSeparator />
        {link ? (
          <ContextMenuItem onSelect={copyLink}>
            <Link2 aria-hidden />
            {t('hub.copyLink')}
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem onSelect={copyId}>
          <Copy aria-hidden />
          {t('hub.copySourceId')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
