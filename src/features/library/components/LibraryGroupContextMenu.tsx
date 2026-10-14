import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Copy, FolderOpen } from 'lucide-react'

import { ipc } from '@/shared/api/ipc'
import { copyText } from '@/shared/lib/clipboard'
import { shortenPath } from '@/shared/lib/format'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/shared/ui/ContextMenu'
import { toast, toastAppError } from '@/shared/ui/Toast'

/**
 * What a right click on a group's card offers: the action its own strip carries — fold it away —
 * plus the ones the strip has no room for, which are all about where the group lives. One item per
 * directory (a skills group) or config file (a servers group) opens it in the file manager, and the
 * paths can be taken away together.
 *
 * The trigger is the group's strip, never the cards under it: a skill or a server keeps its own
 * menu, so the two never fight over one right click.
 */
export function LibraryGroupContextMenu({
  title,
  collapsed,
  locations,
  onToggleCollapsed,
  children,
}: {
  title: string
  collapsed: boolean
  /** The directories or config files the group lives in, in the order the strip lists them. */
  locations: string[]
  onToggleCollapsed: () => void
  children: ReactNode
}) {
  const { t } = useTranslation()
  const toggleLabel = collapsed
    ? t('library.expandGroup', { name: title })
    : t('library.collapseGroup', { name: title })

  const copyPaths = () => {
    void copyText(locations.join('\n')).then((ok) => {
      if (ok) toast.success(t('toast.copied'), locations.join(', '))
    })
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent aria-label={title}>
        <ContextMenuLabel>{title}</ContextMenuLabel>

        <ContextMenuItem onSelect={onToggleCollapsed}>
          {collapsed ? <ChevronRight aria-hidden /> : <ChevronDown aria-hidden />}
          {toggleLabel}
        </ContextMenuItem>

        {locations.length > 0 ? (
          <>
            <ContextMenuSeparator />
            {locations.map((location) => (
              <ContextMenuItem
                key={location}
                onSelect={() => void ipc.revealPath(location).catch(toastAppError)}
              >
                <FolderOpen aria-hidden />
                {locations.length === 1 ? (
                  t('common.reveal')
                ) : (
                  <span className="max-w-64 truncate font-mono">{shortenPath(location)}</span>
                )}
              </ContextMenuItem>
            ))}
            <ContextMenuItem onSelect={copyPaths}>
              <Copy aria-hidden />
              {locations.length === 1 ? t('common.copy') : t('library.copyPaths')}
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  )
}
