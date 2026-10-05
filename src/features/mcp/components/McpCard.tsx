import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, FileCode2, Trash2 } from 'lucide-react'

import type { AgentRef } from '@/shared/bindings/AgentRef'
import type { McpServer } from '@/shared/bindings/McpServer'
import { AgentTag } from '@/shared/ui/AgentTag'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { CodeViewer } from '@/shared/ui/CodeViewer'
import { PathRow } from '@/shared/ui/PathRow'
import { Reveal } from '@/shared/ui/Reveal'
import { Timestamp } from '@/shared/ui/Timestamp'
import { Tooltip } from '@/shared/ui/Tooltip'

import type { EditorDocument } from '@/features/editor/model'

import { SecretValue } from './SecretValue'

function TransportBadge({ server }: { server: McpServer }) {
  const tone =
    server.transport.type === 'http'
      ? 'info'
      : server.transport.type === 'stdio'
        ? 'accent'
        : 'neutral'
  return <Badge tone={tone}>{server.transport.type}</Badge>
}

/** One MCP server, with its transport, secrets and the file it lives in. */
export function McpCard({
  server,
  agents,
  sourceDocument,
  onOpen,
  onDelete,
}: {
  server: McpServer
  /** Every agent that declares a server with this name; defaults to this server's owner. */
  agents?: AgentRef[]
  /** The config file the entry lives in, when the scan found one Ahabby may address. */
  sourceDocument?: EditorDocument | null
  onOpen?: (document: EditorDocument) => void
  onDelete?: (server: McpServer) => void
}) {
  const { t } = useTranslation()
  const [showRaw, setShowRaw] = useState(false)
  const agentId = server.agent.id
  const owners = agents ?? [server.agent]
  // On the agent's own page the owner is implicit; the library passes `agents` explicitly so
  // every card names the file's agent, even when only one declares it.
  const showOwners = agents !== undefined || owners.length > 1

  return (
    <Card className="group ease-warm hover:border-border-strong flex flex-col gap-3 p-4 transition-[border-color,translate] duration-150 hover:-translate-y-px">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-foreground group-hover:text-accent-strong font-serif text-[0.9375rem]">
              {server.name}
            </span>
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
          {showOwners ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {owners.map((agent) => (
                <AgentTag key={agent.id} agent={agent} />
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {sourceDocument && onOpen ? (
            <Tooltip
              content={sourceDocument.editable ? t('mcp.editConfig') : t('configs.notEditable')}
            >
              <Button variant="ghost" size="sm" onClick={() => onOpen(sourceDocument)}>
                <FileCode2 className="size-3.5" aria-hidden />
                {sourceDocument.editable ? t('mcp.editConfig') : t('configs.view')}
              </Button>
            </Tooltip>
          ) : null}
          {onDelete && server.removable ? (
            <Button variant="ghost" size="sm" onClick={() => onDelete(server)}>
              <Trash2 className="size-3.5" aria-hidden />
              {t('mcp.delete')}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {server.transport.type === 'stdio' ? (
          <>
            <div className="flex flex-col gap-1">
              <span className="text-faint text-[0.6875rem] tracking-wide uppercase">
                {t('mcp.command')}
              </span>
              <code className="bg-surface-2 rounded-md px-2 py-1 font-mono text-[0.75rem] break-all">
                {server.transport.command}
              </code>
            </div>
            {server.transport.args.length > 0 ? (
              <div className="flex flex-col gap-1">
                <span className="text-faint text-[0.6875rem] tracking-wide uppercase">
                  {t('mcp.args')}
                </span>
                <code className="bg-surface-2 rounded-md px-2 py-1 font-mono text-[0.75rem] break-all">
                  {server.transport.args.join(' ')}
                </code>
              </div>
            ) : null}
          </>
        ) : server.transport.type === 'http' ? (
          <div className="flex flex-col gap-1">
            <span className="text-faint text-[0.6875rem] tracking-wide uppercase">
              {t('mcp.url')} · {server.transport.protocol}
            </span>
            <code className="bg-surface-2 rounded-md px-2 py-1 font-mono text-[0.75rem] break-all">
              {server.transport.url}
            </code>
          </div>
        ) : (
          <code className="bg-surface-2 rounded-md px-2 py-1 font-mono text-[0.75rem] break-all">
            {server.transport.detail}
          </code>
        )}
      </div>

      {server.env.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-faint text-[0.6875rem] tracking-wide uppercase">
            {t('mcp.env')}
          </span>
          {server.env.map((entry) => (
            <SecretValue key={entry.key} agentId={agentId} serverId={server.id} entry={entry} />
          ))}
        </div>
      ) : null}

      {server.headers.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-faint text-[0.6875rem] tracking-wide uppercase">
            {t('mcp.headers')}
          </span>
          {server.headers.map((entry) => (
            <SecretValue key={entry.key} agentId={agentId} serverId={server.id} entry={entry} />
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <span className="text-faint text-[0.6875rem] tracking-wide uppercase">
          {t('mcp.sourceConfig')}
        </span>
        <PathRow path={server.sourceConfig} />
        <Timestamp
          createdMs={server.createdMs}
          modifiedMs={server.modifiedMs}
          className="text-faint text-[0.6875rem]"
        />
      </div>

      <div>
        <Button
          variant="ghost"
          size="sm"
          className="px-0"
          onClick={() => setShowRaw((value) => !value)}
          aria-expanded={showRaw}
        >
          {showRaw ? (
            <ChevronDown className="size-3.5" aria-hidden />
          ) : (
            <ChevronRight className="size-3.5" aria-hidden />
          )}
          {t('mcp.raw')}
        </Button>
        <Reveal open={showRaw}>
          <CodeViewer value={server.raw} format="json" height="40vh" className="mt-2" />
        </Reveal>
      </div>
    </Card>
  )
}
