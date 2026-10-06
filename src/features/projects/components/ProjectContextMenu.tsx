import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, Copy, FolderOpen, Terminal } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { ipc } from '@/shared/api/ipc'
import type { Project } from '@/shared/bindings/Project'
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
 * What a right click on a project card offers: the three actions the card shows — open it,
 * start an agent in its root, show it in the file manager — plus copying the root path.
 *
 * The trigger is the card itself, so the menu also opens from the keyboard context-menu key
 * while any control inside the card has focus.
 */
export function ProjectContextMenu({
  project,
  onRun,
  children,
}: {
  project: Project
  /** When given, the project can be opened as an agent's working directory. */
  onRun?: (project: Project) => void
  children: ReactNode
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const copyPath = () => {
    void copyText(project.root).then((ok) => {
      if (ok) toast.success(t('toast.copied'), project.root)
    })
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent aria-label={project.name}>
        <ContextMenuLabel>{project.name}</ContextMenuLabel>

        <ContextMenuItem onSelect={() => void navigate(`/projects/${project.id}`)}>
          <ArrowUpRight aria-hidden />
          {t('common.open')}
        </ContextMenuItem>

        {onRun ? (
          <ContextMenuItem onSelect={() => onRun(project)}>
            <Terminal aria-hidden />
            {t('projects.runHere')}
          </ContextMenuItem>
        ) : null}

        <ContextMenuSeparator />
        <ContextMenuItem onSelect={copyPath}>
          <Copy aria-hidden />
          {t('common.copy')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void ipc.revealPath(project.root).catch(toastAppError)}>
          <FolderOpen aria-hidden />
          {t('common.reveal')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
