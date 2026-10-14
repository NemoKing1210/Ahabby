import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { FileCode2, Trash2 } from 'lucide-react'

import type { McpServer } from '@/shared/bindings/McpServer'
import { formatDateTime } from '@/shared/lib/format'
import { AgentTag } from '@/shared/ui/AgentTag'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { CodeViewer } from '@/shared/ui/CodeViewer'
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/shared/ui/Dialog'
import { PathRow } from '@/shared/ui/PathRow'
import { Switch } from '@/shared/ui/Switch'
import { Tooltip } from '@/shared/ui/Tooltip'

import type { EditorDocument } from '@/features/editor/model'

import { SecretValue } from './SecretValue'
import { TransportBadge } from './TransportBadge'

/** One labelled value of a server, the shape every section of the dialog wears. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-faint text-[0.6875rem] tracking-wide uppercase">{label}</span>
      {children}
    </div>
  )
}

function Value({ children }: { children: ReactNode }) {
  return (
    <code className="bg-surface-2 rounded-md px-2 py-1 font-mono text-[0.75rem] break-all">
      {children}
    </code>
  )
}

/**
 * Full view of one MCP server: where the entry lives, how it is spoken to, its environment and
 * headers — with the masked values revealed here rather than on the card — and the entry as it
 * stands in the file. The actions of the card are repeated in the footer, so the dialog is the
 * one place the server can be read and switched off from.
 */
export function McpDetailDialog({
  server,
  open,
  onOpenChange,
  sourceDocument,
  onOpenConfig,
  onDelete,
  onToggle,
  toggleBusy,
}: {
  server: McpServer | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The config file the entry lives in, when the scan found one Ahabby may address. */
  sourceDocument?: EditorDocument | null
  onOpenConfig?: (document: EditorDocument) => void
  onDelete?: (server: McpServer) => void
  /** Only offered for a server Ahabby may switch off; the backend refuses the rest. */
  onToggle?: (server: McpServer, enabled: boolean) => void
  /** Disables the switch while its own mutation is in flight. */
  toggleBusy?: boolean
}) {
  const { t, i18n } = useTranslation()
  if (!server) return null

  const secrets = server.env.filter((entry) => entry.masked).length
  const transport = server.transport

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[min(860px,94vw)]"
        footer={
          <>
            <div className="text-faint mr-auto flex flex-wrap items-center gap-2 text-[0.75rem]">
              {server.hasSecrets ? (
                <Badge tone="warning">{t('mcp.secretsHidden', { count: secrets })}</Badge>
              ) : null}
              {server.unverified ? <Badge tone="warning">{t('agents.unverified')}</Badge> : null}
              {!server.removable ? <Badge tone="neutral">{t('mcp.notRemovable')}</Badge> : null}
            </div>
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
            {onOpenConfig && sourceDocument ? (
              <Tooltip
                content={sourceDocument.editable ? t('mcp.editConfig') : t('configs.notEditable')}
              >
                <span className="inline-flex">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onOpenConfig(sourceDocument)}
                  >
                    <FileCode2 className="size-3.5" aria-hidden />
                    {sourceDocument.editable ? t('mcp.editConfig') : t('configs.view')}
                  </Button>
                </span>
              </Tooltip>
            ) : null}
            {onDelete && server.removable ? (
              <Button variant="danger" size="sm" onClick={() => onDelete(server)}>
                <Trash2 className="size-3.5" aria-hidden />
                {t('mcp.delete')}
              </Button>
            ) : null}
          </>
        }
      >
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>{server.name}</DialogTitle>
            {!server.enabled ? <Badge tone="neutral">{t('mcp.disabled')}</Badge> : null}
            <TransportBadge server={server} />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <AgentTag agent={server.agent} />
          </div>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-faint text-[0.6875rem] tracking-wide uppercase">
              {t('mcp.sourceConfig')}
            </span>
            <PathRow path={server.sourceConfig} />
            {server.keyPath.length > 0 ? (
              <Field label={t('mcp.keyPath')}>
                <Value>{server.keyPath.join('.')}</Value>
              </Field>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[0.75rem]">
            <span className="flex items-baseline gap-1.5">
              <span className="text-faint text-[0.6875rem] tracking-wide uppercase">
                {t('library.created')}
              </span>
              <span className="text-muted">
                {formatDateTime(server.createdMs, i18n.language) ?? t('common.notAvailable')}
              </span>
            </span>
            <span className="flex items-baseline gap-1.5">
              <span className="text-faint text-[0.6875rem] tracking-wide uppercase">
                {t('library.modified')}
              </span>
              <span className="text-muted">
                {formatDateTime(server.modifiedMs, i18n.language) ?? t('common.notAvailable')}
              </span>
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <span className="text-faint text-[0.6875rem] tracking-wide uppercase">
              {t('mcp.transport')}
            </span>
            {transport.type === 'stdio' ? (
              <>
                <Field label={t('mcp.command')}>
                  <Value>{transport.command}</Value>
                </Field>
                {transport.args.length > 0 ? (
                  <Field label={t('mcp.args')}>
                    <Value>{transport.args.join(' ')}</Value>
                  </Field>
                ) : null}
              </>
            ) : transport.type === 'http' ? (
              <Field label={`${t('mcp.url')} · ${transport.protocol}`}>
                <Value>{transport.url}</Value>
              </Field>
            ) : (
              <Value>{transport.detail}</Value>
            )}
          </div>

          {server.env.length > 0 ? (
            <Field label={t('mcp.env')}>
              <div className="flex flex-col gap-1.5">
                {server.env.map((entry) => (
                  <SecretValue
                    key={entry.key}
                    agentId={server.agent.id}
                    serverId={server.id}
                    entry={entry}
                  />
                ))}
              </div>
            </Field>
          ) : null}

          {server.headers.length > 0 ? (
            <Field label={t('mcp.headers')}>
              <div className="flex flex-col gap-1.5">
                {server.headers.map((entry) => (
                  <SecretValue
                    key={entry.key}
                    agentId={server.agent.id}
                    serverId={server.id}
                    entry={entry}
                  />
                ))}
              </div>
            </Field>
          ) : null}

          <Field label={t('mcp.raw')}>
            <CodeViewer value={server.raw} format="json" height="40vh" />
          </Field>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
