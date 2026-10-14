import { RotateCcw, Terminal as TerminalIcon, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/shared/lib/cn'
import { fileName } from '@/shared/lib/format'
import { AgentIcon } from '@/shared/ui/AgentIcon'
import { Button } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Tooltip } from '@/shared/ui/Tooltip'

import { shortenCommand } from '../lib/terminal'
import type { TerminalSessionState } from '../store'
import { TerminalView } from './TerminalView'

/**
 * One pane: a cell of a workspace holding one session, or an invitation to start one.
 *
 * The title strip is the pane's own account of itself — which agent, where, and the way to end it —
 * and it is only drawn when the workspace holds more than one pane: a lone pane *is* the terminal,
 * and dressing it up would make the unsplit dock different from what it has always been. The
 * focused pane wears the accent the active tab wore, so where the keyboard is stays obvious.
 */
export function TerminalPane({
  session,
  titled,
  focused,
  icon,
  restarting = false,
  onFocus,
  onStart,
  onRestart,
  onClose,
}: {
  session: TerminalSessionState | null
  /** The workspace holds more than one pane, so every cell has to say what it is. */
  titled: boolean
  focused: boolean
  /** The brand key of the agent, for the tile in the title strip. */
  icon?: string | null
  /** A restart of this pane's agent is in flight: the button waits rather than starting a second. */
  restarting?: boolean
  onFocus: () => void
  onStart: () => void
  onRestart: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()

  return (
    <div
      // A press anywhere in the pane — canvas, title, find bar — is what puts the keyboard in it.
      onPointerDown={onFocus}
      className="bg-background ease-warm flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl transition-colors duration-150"
    >
      {/* Every cell of a split workspace is labelled, empty or not: a grid whose cells start at
          different heights reads as broken, and which cell is empty is worth saying. */}
      {titled ? (
        <div
          className={cn(
            'border-border flex h-7 shrink-0 items-center gap-1.5 border-b px-1.5',
            focused ? 'bg-accent-soft text-accent-strong' : 'bg-surface-2 text-muted',
          )}
        >
          {session ? (
            <>
              <AgentIcon name={session.agentName} icon={icon} size="xs" />
              <span className="max-w-40 truncate text-[0.75rem]">{session.agentName}</span>
              <span className="text-faint min-w-0 flex-1 truncate text-[0.6875rem]">
                {fileName(session.cwd)}
              </span>
              <Tooltip content={shortenCommand(session.command)} side="top">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={cn('size-5', !focused && 'opacity-60')}
                  aria-label={t('terminal.closeTab', { agent: session.agentName })}
                  onClick={onClose}
                >
                  <X className="size-3" aria-hidden />
                </Button>
              </Tooltip>
            </>
          ) : (
            <>
              <span
                aria-hidden
                className="text-faint flex size-4 shrink-0 items-center justify-center"
              >
                <TerminalIcon className="size-3" />
              </span>
              <span className="truncate text-[0.75rem]">{t('terminal.paneEmpty')}</span>
              <span className="min-w-0 flex-1" />
            </>
          )}
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1">
        {session ? (
          <TerminalView session={session} visible focusable={focused} />
        ) : (
          <div className="flex h-full items-center justify-center p-3">
            <EmptyState
              title={t('terminal.paneEmptyHint')}
              className="w-full py-6"
              action={
                <Button variant="secondary" size="sm" onClick={onStart}>
                  {t('terminal.paneStart')}
                </Button>
              }
            />
          </div>
        )}
      </div>

      {/* The ended session takes its own strip instead of floating over the terminal: the last rows
          an agent printed are exactly the ones a user needs to read. */}
      {session && !session.running ? (
        <div className="border-border bg-surface-2 flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-2 py-1.5">
          <span className="text-muted text-[0.75rem]">
            {t('terminal.exited', { code: session.exitCode ?? '—' })}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="secondary" size="sm" loading={restarting} onClick={onRestart}>
              {restarting ? null : <RotateCcw className="size-3.5" aria-hidden />}
              {t('terminal.restart')}
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t('terminal.closeTabAction')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
