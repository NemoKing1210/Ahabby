import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Copy, FolderOpen, Pencil, Plus } from 'lucide-react'

import { ipc } from '@/shared/api/ipc'
import type { OtherResource } from '@/shared/bindings/OtherResource'
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

/**
 * What a right click on an "Other" resource card offers: the same expand and edit actions the
 * card shows, plus the two path actions. Items only appear when they can run, so the menu of a
 * directory never offers an editor it has no document for.
 *
 * The trigger is the card itself, so the menu also opens from the keyboard context-menu key
 * while any control inside the card has focus.
 */
export function OtherResourceContextMenu({
  resource,
  expanded,
  hasBody,
  onToggleExpanded,
  onEdit,
  children,
}: {
  resource: OtherResource
  expanded: boolean
  /** Whether the resource has content worth revealing — the card's own expand gate. */
  hasBody: boolean
  onToggleExpanded: () => void
  /** Only offered for a file; a directory has no document Ahabby can open. */
  onEdit?: (resource: OtherResource) => void
  children: ReactNode
}) {
  const { t } = useTranslation()
  const missing = !resource.exists

  const copyPath = () => {
    void copyText(resource.path).then((ok) => {
      if (ok) toast.success(t('toast.copied'), resource.path)
    })
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent aria-label={resource.label}>
        <ContextMenuLabel>{resource.label}</ContextMenuLabel>

        {hasBody ? (
          <ContextMenuItem onSelect={onToggleExpanded}>
            {expanded ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
            {expanded ? t('common.collapse') : t('common.expand')}
          </ContextMenuItem>
        ) : null}

        {onEdit && !resource.isDirectory ? (
          <ContextMenuItem onSelect={() => onEdit(resource)}>
            {missing ? <Plus aria-hidden /> : <Pencil aria-hidden />}
            {missing ? t('configs.create') : t('configs.edit')}
          </ContextMenuItem>
        ) : null}

        <ContextMenuSeparator />
        <ContextMenuItem onSelect={copyPath}>
          <Copy aria-hidden />
          {t('common.copy')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void ipc.revealPath(resource.path).catch(toastAppError)}>
          <FolderOpen aria-hidden />
          {t('common.reveal')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
