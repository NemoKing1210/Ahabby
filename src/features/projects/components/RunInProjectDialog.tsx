import { useTranslation } from 'react-i18next'
import { Terminal as TerminalIcon } from 'lucide-react'

import type { Agent } from '@/shared/bindings/Agent'
import type { Project } from '@/shared/bindings/Project'
import { AgentIcon } from '@/shared/ui/AgentIcon'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { EmptyState } from '@/shared/ui/EmptyState'

import { useAgents } from '@/features/agents/api/queries'
import { useRunAgentInTerminal } from '@/features/terminal/api/hooks'

/**
 * "Run agent here": picks which installed agent starts in the project's root.
 *
 * Only installed agents are offered — the backend would refuse a start otherwise — and the
 * frontend sends nothing but the agent id and the project root as the working directory.
 */
export function RunInProjectDialog({
  project,
  onClose,
}: {
  project: Project
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { data } = useAgents()
  const run = useRunAgentInTerminal()

  const agents = (data?.agents ?? [])
    .filter((agent) => agent.status === 'installed')
    .sort((a, b) => a.name.localeCompare(b.name))

  const start = (agent: Agent) => {
    run(agent, project.root)
    onClose()
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="w-[min(520px,92vw)]">
        <DialogHeader>
          <DialogTitle>{t('projects.runTitle')}</DialogTitle>
          <DialogDescription>{t('projects.runBody', { path: project.root })}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {agents.length === 0 ? (
            <EmptyState icon={TerminalIcon} title={t('projects.noAgents')} />
          ) : (
            <div className="flex flex-col gap-1">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => start(agent)}
                  className="hover:bg-surface-2 flex items-center gap-3 rounded-lg px-2 py-2 text-left"
                >
                  <AgentIcon name={agent.name} icon={agent.icon} ownerId={agent.id} size="sm" />
                  <span className="text-foreground min-w-0 flex-1 truncate text-[0.875rem]">
                    {agent.name}
                  </span>
                  <TerminalIcon className="text-faint size-4 shrink-0" aria-hidden />
                </button>
              ))}
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
