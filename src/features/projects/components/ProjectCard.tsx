import { useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { FileText, FolderOpen, Plug, Sparkles, Terminal as TerminalIcon } from 'lucide-react'

import type { Project } from '@/shared/bindings/Project'
import { formatRelative } from '@/shared/lib/format'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { PathRow } from '@/shared/ui/PathRow'
import { toastAppError } from '@/shared/ui/Toast'
import { Tooltip } from '@/shared/ui/Tooltip'

import { useRevealPath } from '@/features/agents/api/queries'

import { ProjectContextMenu } from './ProjectContextMenu'
import { RunInProjectDialog } from './RunInProjectDialog'

/**
 * One project discovered under an added folder: what it is, what it holds and the three
 * actions that make sense on it — open it, show it in the file manager, or start an agent in
 * its root. The body opens the project; the action column never does.
 */
export function ProjectCard({ project }: { project: Project }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const reveal = useRevealPath()
  const [runOpen, setRunOpen] = useState(false)

  const open = () => {
    void navigate(`/projects/${project.id}`)
  }

  // The body is a div rather than a button — it holds the block content the card needs — so
  // Enter/Space are wired by hand to keep it reachable from the keyboard.
  const activate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      open()
    }
  }

  const changed = formatRelative(project.modifiedMs, i18n.language)
  const counts = [
    { key: 'skills' as const, count: project.skills.length, icon: Sparkles },
    { key: 'mcp' as const, count: project.mcpServers.length, icon: Plug },
    { key: 'other' as const, count: project.other.length, icon: FileText },
  ].filter((entry) => entry.count > 0)

  return (
    <ProjectContextMenu project={project} onRun={() => setRunOpen(true)}>
      <Card className="group ease-warm hover:border-border-strong transition-[border-color,translate] duration-150 hover:-translate-y-px">
        <div className="flex items-start gap-4 p-4">
          <div
            role="button"
            tabIndex={0}
            aria-label={project.name}
            onClick={(event) => {
              // The path row's copy/reveal buttons live inside the body; a click there must not
              // also open the project.
              if ((event.target as HTMLElement).closest('button')) return
              open()
            }}
            onKeyDown={activate}
            className="focus-visible:outline-ring flex min-w-0 flex-1 cursor-pointer flex-col gap-1.5 rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <span className="group-hover:text-accent-strong text-foreground font-serif text-[0.9375rem]">
              {project.name}
            </span>

            <PathRow path={project.root} className="max-w-xl" />

            {counts.length > 0 || changed ? (
              <div className="text-faint flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-0.5 text-[0.75rem]">
                {counts.map((entry) => (
                  <Badge key={entry.key} tone="neutral">
                    <entry.icon className="size-3" aria-hidden />
                    {t(`agents.card.${entry.key}`, { count: entry.count })}
                  </Badge>
                ))}
                {changed ? (
                  <span>
                    {t('library.modified')} {changed}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <Tooltip content={t('projects.runHere')}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('projects.runHere')}
                onClick={() => setRunOpen(true)}
              >
                <TerminalIcon className="size-3.5" />
              </Button>
            </Tooltip>
            <Tooltip content={t('projects.reveal')}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('projects.reveal')}
                onClick={() => reveal.mutate(project.root, { onError: toastAppError })}
              >
                <FolderOpen className="size-3.5" />
              </Button>
            </Tooltip>
            <Button variant="secondary" size="sm" onClick={open}>
              {t('common.open')}
            </Button>
          </div>
        </div>

        {runOpen ? (
          <RunInProjectDialog project={project} onClose={() => setRunOpen(false)} />
        ) : null}
      </Card>
    </ProjectContextMenu>
  )
}
