import { memo, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { FileCode2, Server, Trash2 } from 'lucide-react'

import type { AgentRef } from '@/shared/bindings/AgentRef'
import type { McpServer } from '@/shared/bindings/McpServer'
import { cn } from '@/shared/lib/cn'
import { shortenPath } from '@/shared/lib/format'
import { AgentTag } from '@/shared/ui/AgentTag'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Switch } from '@/shared/ui/Switch'
import { Timestamp } from '@/shared/ui/Timestamp'
import { Tooltip } from '@/shared/ui/Tooltip'

import type { EditorDocument } from '@/features/editor/model'

import { McpContextMenu } from './McpContextMenu'
import { TransportBadge } from './TransportBadge'

/** How the server is spoken to, in the one line a card has room for. */
function transportLine(server: McpServer): string {
  const transport = server.transport
  if (transport.type === 'stdio') return [transport.command, ...transport.args].join(' ')
  if (transport.type === 'http') return transport.url
  return transport.detail
}

/**
 * One MCP server, in the same shape as a skill card: a neutral tile, the name in the serif
 * face, the transport in one line, the owners and the quiet metadata — and the actions in
 * their own column, so a click there never opens the detail view. Everything the card has no
 * room for (the arguments, the environment, the headers, the entry as it stands) lives in
 * `McpDetailDialog`, which a click on the card opens.
 *
 * `agents` is what turns the card into a library card — the agent page already knows whose
 * list it is showing, so it leaves the owners off.
 *
 * Memoized like `SkillCard`: the library shows every server of every agent, and the handlers it
 * receives are stable callbacks of the page, so a filter that leaves it in place does not redraw it.
 */
export const McpCard = memo(function McpCard({
  server,
  agents,
  sourceDocument,
  onOpen,
  onOpenConfig,
  onDelete,
  onToggle,
  toggleBusy,
  cloudAction,
}: {
  server: McpServer
  /** Every agent that declares a server with this name; defaults to this server's owner. */
  agents?: AgentRef[]
  /** The config file the entry lives in, when the scan found one Ahabby may address. */
  sourceDocument?: EditorDocument | null
  onOpen?: (server: McpServer) => void
  onOpenConfig?: (document: EditorDocument) => void
  onDelete?: (server: McpServer) => void
  /** Only offered for a server Ahabby may switch off; the backend refuses the rest. */
  onToggle?: (server: McpServer, enabled: boolean) => void
  /** Disables this card's switch while its own mutation is in flight. */
  toggleBusy?: boolean
  /** The cloud state and actions of the file this entry lives in, when the page offers them. */
  cloudAction?: ReactNode
}) {
  const { t } = useTranslation()
  const owners = agents ?? [server.agent]
  // On the agent's own page the owner is implicit; the library passes `agents` explicitly so
  // every card names the file's agent, even when only one declares it.
  const showOwners = agents !== undefined || owners.length > 1
  const open = onOpen ? () => onOpen(server) : undefined

  // The body is a div rather than a button: a button may not contain the block content the
  // card needs. Enter/Space keep it reachable from the keyboard.
  const activate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!open) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      open()
    }
  }

  return (
    <McpContextMenu
      server={server}
      sourceDocument={sourceDocument}
      onOpen={onOpen}
      onOpenConfig={onOpenConfig}
      onDelete={onDelete}
      onToggle={onToggle}
    >
      <Card
        className={cn(
          'group ease-warm hover:border-border-strong relative transition-[border-color,translate] duration-150 hover:-translate-y-px',
          !server.enabled && 'border-dashed',
        )}
      >
        <div className="flex items-start gap-4 p-4">
          <div
            role="button"
            tabIndex={0}
            aria-label={server.name}
            onClick={open}
            onKeyDown={activate}
            className="focus-visible:outline-ring flex min-w-0 flex-1 cursor-pointer items-start gap-4 rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <span
              aria-hidden
              className={cn(
                'border-border bg-surface-2 text-accent-strong inline-flex size-10 shrink-0 items-center justify-center rounded-lg border',
                !server.enabled && 'opacity-60',
              )}
            >
              <Server className="size-4" />
            </span>

            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    'group-hover:text-accent-strong font-serif text-[0.9375rem]',
                    server.enabled ? 'text-foreground' : 'text-muted',
                  )}
                >
                  {server.name}
                </span>
                {!server.enabled ? <Badge tone="neutral">{t('mcp.disabled')}</Badge> : null}
                <TransportBadge server={server} />
                {server.hasSecrets ? (
                  <Badge tone="warning">
                    {t('mcp.secretsHidden', {
                      count: server.env.filter((entry) => entry.masked).length,
                    })}
                  </Badge>
                ) : null}
                {server.unverified ? <Badge tone="warning">{t('agents.unverified')}</Badge> : null}
              </div>

              <p className="text-muted truncate font-mono text-[0.75rem]">
                {transportLine(server)}
              </p>

              {showOwners ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {owners.map((agent) => (
                    <AgentTag key={agent.id} agent={agent} />
                  ))}
                </div>
              ) : null}

              <div className="text-faint flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-[0.75rem]">
                <code className="font-mono">{shortenPath(server.sourceConfig, 4)}</code>
                <Timestamp createdMs={server.createdMs} modifiedMs={server.modifiedMs} />
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {onToggle && server.removable ? (
              <Tooltip content={t('mcp.switchHint')}>
                <span className="inline-flex">
                  <Switch
                    checked={server.enabled}
                    disabled={toggleBusy}
                    onCheckedChange={(next) => onToggle(server, next)}
                    aria-label={server.enabled ? t('mcp.toggleOff') : t('mcp.toggleOn')}
                  />
                </span>
              </Tooltip>
            ) : null}
            <Button variant="secondary" size="sm" onClick={open} disabled={!open}>
              {t('common.open')}
            </Button>
            {onOpenConfig && sourceDocument ? (
              <Tooltip
                content={sourceDocument.editable ? t('mcp.editConfig') : t('configs.notEditable')}
              >
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={sourceDocument.editable ? t('mcp.editConfig') : t('configs.view')}
                  onClick={() => onOpenConfig(sourceDocument)}
                >
                  <FileCode2 className="size-3.5" />
                </Button>
              </Tooltip>
            ) : null}
            {onDelete && server.removable ? (
              <Tooltip content={t('mcp.delete')}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('mcp.delete')}
                  onClick={() => onDelete(server)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </Tooltip>
            ) : null}
          </div>
        </div>

        {cloudAction ? (
          <div className="border-border flex flex-wrap items-center justify-end gap-2 border-t px-4 py-2.5">
            {cloudAction}
          </div>
        ) : null}
      </Card>
    </McpContextMenu>
  )
})
