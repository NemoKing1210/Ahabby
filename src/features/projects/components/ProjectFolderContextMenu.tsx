import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, Trash2 } from 'lucide-react'

import { ipc } from '@/shared/api/ipc'
import type { ProjectFolderStatus } from '@/shared/bindings/ProjectFolderStatus'
import { fileName } from '@/shared/lib/format'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/shared/ui/ContextMenu'
import { toastAppError } from '@/shared/ui/Toast'

/**
 * What a right click on an added-folder card offers: show the folder in the file manager, or
 * forget it in Ahabby. Reveal is left out for a folder that is not on disk right now, so the
 * menu never offers a call the backend would only fail.
 *
 * The trigger is the card itself, so the menu also opens from the keyboard context-menu key
 * while any control inside the card has focus.
 */
export function ProjectFolderContextMenu({
  status,
  onRemove,
  children,
}: {
  status: ProjectFolderStatus
  onRemove: (status: ProjectFolderStatus) => void
  children: ReactNode
}) {
  const { t } = useTranslation()
  const directory = status.resolved ?? status.folder.path
  const label = fileName(directory) || directory

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent aria-label={label}>
        <ContextMenuLabel>{label}</ContextMenuLabel>

        {status.exists ? (
          <>
            <ContextMenuItem onSelect={() => void ipc.revealPath(directory).catch(toastAppError)}>
              <FolderOpen aria-hidden />
              {t('common.reveal')}
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        ) : null}

        <ContextMenuItem destructive onSelect={() => onRemove(status)}>
          <Trash2 aria-hidden />
          {t('projects.remove')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
