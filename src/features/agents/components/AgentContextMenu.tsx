import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Copy,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Info,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { ipc } from '@/shared/api/ipc'
import type { Agent } from '@/shared/bindings/Agent'
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
 * What a right click on an agent card offers: the same actions the card's buttons perform,
 * minus the ones that need a keyboard — plus the two path actions the card does not have
 * room for. Items only appear when they can actually run, so a menu never shows a dead end.
 *
 * The trigger is the card itself, so the menu also opens from the keyboard context-menu key
 * while any control inside the card has focus.
 */
export function AgentContextMenu({
  agent,
  onInstall,
  onRemove,
  children,
}: {
  agent: Agent
  onInstall: (agent: Agent, action: 'install' | 'update') => void
  onRemove?: (agent: Agent) => void
  children: ReactNode
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const action =
    agent.status === 'installed'
      ? agent.canUpdate
        ? ('update' as const)
        : null
      : agent.canInstall
        ? ('install' as const)
        : null

  // With the version when we know it, so the menu says what the update would install.
  const label =
    action === 'install'
      ? t('agents.install')
      : agent.update
        ? t('agents.updateTo', { version: agent.update.latest })
        : t('agents.update')

  const copyPath = () => {
    const path = agent.binaryPath ?? ''
    void copyText(path).then((ok) => {
      if (ok) toast.success(t('toast.copied'), path)
    })
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent aria-label={agent.name}>
        <ContextMenuLabel>{agent.name}</ContextMenuLabel>

        <ContextMenuItem onSelect={() => void navigate(`/agents/${agent.id}`)}>
          <Info aria-hidden />
          {t('agents.menu.open')}
        </ContextMenuItem>

        {agent.website ? (
          <ContextMenuItem
            onSelect={() => void ipc.openUrl(agent.website ?? '').catch(toastAppError)}
          >
            <ExternalLink aria-hidden />
            {t('agents.website')}
          </ContextMenuItem>
        ) : null}

        {agent.docs ? (
          <ContextMenuItem onSelect={() => void ipc.openUrl(agent.docs ?? '').catch(toastAppError)}>
            <FileText aria-hidden />
            {t('agents.docs')}
          </ContextMenuItem>
        ) : null}

        {agent.binaryPath ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={copyPath}>
              <Copy aria-hidden />
              {t('common.copy')}
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => void ipc.revealPath(agent.binaryPath ?? '').catch(toastAppError)}
            >
              <FolderOpen aria-hidden />
              {t('common.reveal')}
            </ContextMenuItem>
          </>
        ) : null}

        {action ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => onInstall(agent, action)}>
              {action === 'update' ? <RefreshCw aria-hidden /> : <Download aria-hidden />}
              {label}
            </ContextMenuItem>
          </>
        ) : null}

        {onRemove ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem destructive onSelect={() => onRemove(agent)}>
              <Trash2 aria-hidden />
              {t('agents.remove')}
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  )
}
