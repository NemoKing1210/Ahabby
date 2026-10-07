import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Play } from 'lucide-react'

import type { TerminalCatalog } from '@/shared/bindings/TerminalCatalog'
import { shortenPath } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Input } from '@/shared/ui/Input'
import { Select } from '@/shared/ui/Select'
import { toastAppError } from '@/shared/ui/Toast'
import { agentOption } from '@/shared/ui/agentOptions'

import { useAgents, useFavoriteAgents } from '@/features/agents/api/queries'
import { installedAgents } from '@/features/agents/lib/favorites'

import { useLaunchTerminal } from '../api/hooks'
import { useTerminalStore } from '../store'

/**
 * Open one more tab: which agent, and where.
 *
 * The working directory matters — agents work on a project — so it is asked for and defaults to
 * the home directory. The resolved executable is shown, exactly like the install dialog shows the
 * resolved command, because the frontend cannot choose what runs and should not pretend to.
 */
export function NewTerminalDialog({
  catalog,
  onOpenChange,
}: {
  catalog: TerminalCatalog
  onOpenChange: () => void
}) {
  const { t } = useTranslation()
  const { data: report } = useAgents()
  const favoriteIds = useFavoriteAgents()
  const launch = useLaunchTerminal()
  const open = useTerminalStore((state) => state.open)

  // Pinned agents first, as everywhere else an agent is chosen, so the dialog opens on the one
  // the user works with.
  const installed = useMemo(
    () => installedAgents(report?.agents ?? [], favoriteIds),
    [report, favoriteIds],
  )
  const [agentId, setAgentId] = useState('')
  const [cwd, setCwd] = useState(catalog.defaultCwd)
  // The scan can land after this dialog is opened, so an empty choice has to fall back to the
  // first agent on screen rather than leaving the dialog unusable until it is closed and opened
  // again.
  const selected = installed.find((agent) => agent.id === agentId) ?? installed[0]

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        footer={
          <>
            <Button variant="ghost" onClick={onOpenChange}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={!selected || cwd.trim().length === 0}
              loading={launch.isPending}
              onClick={() => {
                if (!selected) return
                launch.mutate(
                  { agentId: selected.id, cwd: cwd.trim() },
                  {
                    onSuccess: (session) => {
                      open(session)
                      onOpenChange()
                    },
                    onError: (error) => toastAppError(error),
                  },
                )
              }}
            >
              {launch.isPending ? null : <Play className="size-3.5" aria-hidden />}
              {t('terminal.open')}
            </Button>
          </>
        }
      >
        <DialogHeader>
          <DialogTitle>{t('terminal.new')}</DialogTitle>
          <DialogDescription>{t('terminal.newHint')}</DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          {installed.length === 0 ? (
            <EmptyState title={t('terminal.noAgents')} />
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm">{t('terminal.agent')}</span>
                <Select
                  ariaLabel={t('terminal.agent')}
                  value={selected?.id ?? ''}
                  onValueChange={setAgentId}
                  className="w-full"
                  options={installed.map((agent) =>
                    agentOption(agent, { description: agent.version?.raw }),
                  )}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-sm">{t('terminal.workingDirectory')}</span>
                <Input
                  value={cwd}
                  aria-label={t('terminal.workingDirectory')}
                  placeholder={catalog.defaultCwd}
                  onChange={(event) => setCwd(event.target.value)}
                />
                <p className="text-faint text-[0.75rem]">{t('terminal.workingDirectoryHint')}</p>
              </div>

              {selected?.binaryPath ? (
                <div className="border-border bg-surface-2 flex flex-col gap-1 rounded-lg border p-3">
                  <span className="text-faint text-[0.6875rem] tracking-wide uppercase">
                    {t('terminal.command')}
                  </span>
                  <code className="text-muted truncate font-mono text-[0.75rem]">
                    {shortenPath(selected.binaryPath, 6)}
                  </code>
                </div>
              ) : null}
            </>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
