import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plug, Plus } from 'lucide-react'

import type { AgentRef } from '@/shared/bindings/AgentRef'
import type { ConfigFile } from '@/shared/bindings/ConfigFile'
import type { McpServer } from '@/shared/bindings/McpServer'
import { matchesActivity, type ActivityFilter } from '@/shared/lib/activity'
import { ActivityChips } from '@/shared/ui/ActivityChips'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Button } from '@/shared/ui/Button'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { EmptyState } from '@/shared/ui/EmptyState'
import { toast, toastAppError } from '@/shared/ui/Toast'

import { DocumentEditorDialog } from '@/features/editor/components/DocumentEditorDialog'
import { configDocument, type EditorDocument } from '@/features/editor/model'

import { useDeleteMcpServer, useSetMcpServerEnabled } from '../api/hooks'
import { CreateMcpServerDialog } from './CreateMcpServerDialog'
import { McpCard } from './McpCard'

/**
 * MCP servers of one agent, with removal backed by a timestamped backup.
 *
 * A server is only ever defined inside a real file, so the card also offers that file in the
 * editor — read-only when the manifest says so (the CLI-owned `settings.json` of Claude Code,
 * for instance). The entry itself still has to be edited as JSON.
 *
 * `owner` is present only when the agent can hold a new server (it is installed): the tab then
 * offers adding one, in the config file the manifest declares.
 */
export function McpTab({
  agentId,
  servers,
  configs,
  owner,
}: {
  agentId: string
  servers: McpServer[]
  /** Config files of the same agent, used to resolve each server's source file. */
  configs: ConfigFile[]
  owner?: AgentRef | null
}) {
  const { t } = useTranslation()
  const remove = useDeleteMcpServer()
  const toggle = useSetMcpServerEnabled()
  const [deleteTarget, setDeleteTarget] = useState<McpServer | null>(null)
  const [open, setOpen] = useState<EditorDocument | null>(null)
  const [activity, setActivity] = useState<ActivityFilter>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const createButton = owner ? (
    <Button variant="secondary" size="sm" onClick={() => setCreateOpen(true)}>
      <Plus className="size-3.5" aria-hidden />
      {t('mcp.create')}
    </Button>
  ) : null

  // Every card carries a switch, so the list can be narrowed to what is on or off — the state
  // is on the scanned server itself, nothing to remember here.
  const visible = servers.filter((server) => matchesActivity(server.enabled, activity))

  const toggleServer = (server: McpServer, enabled: boolean) => {
    toggle.mutate(
      { agentId, serverId: server.id, enabled },
      {
        onSuccess: (result) => {
          toast.success(t(enabled ? 'mcp.toggledOn' : 'mcp.toggledOff', { name: result.data.name }))
        },
        onError: (error) => toastAppError(error),
      },
    )
  }

  const documentFor = (server: McpServer): EditorDocument | null => {
    const config = configs.find((candidate) => candidate.path === server.sourceConfig)
    return config ? configDocument(config) : null
  }

  if (servers.length === 0) {
    return (
      <>
        <EmptyState
          title={t('mcp.none')}
          hint={owner ? t('mcp.noneHintCreate') : t('mcp.noneHint')}
          icon={Plug}
          action={createButton}
        />
        {createOpen && owner ? (
          <CreateMcpServerDialog owners={[owner]} onClose={() => setCreateOpen(false)} />
        ) : null}
      </>
    )
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ActivityChips items={servers} value={activity} onChange={setActivity} />
          {createButton}
        </div>
        {visible.length === 0 ? (
          <EmptyState
            title={t(activity === 'on' ? 'activity.noneOn' : 'activity.noneOff')}
            hint={t('activity.noneHint')}
            icon={Plug}
          />
        ) : (
          <AnimatedList>
            {visible.map((server) => (
              <McpCard
                key={server.id}
                server={server}
                sourceDocument={documentFor(server)}
                onOpen={setOpen}
                onDelete={setDeleteTarget}
                onToggle={toggleServer}
                toggleBusy={toggle.isPending && toggle.variables?.serverId === server.id}
              />
            ))}
          </AnimatedList>
        )}
      </div>

      {createOpen && owner ? (
        <CreateMcpServerDialog owners={[owner]} onClose={() => setCreateOpen(false)} />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(next) => {
          if (!next) setDeleteTarget(null)
        }}
        title={t('mcp.deleteTitle', { name: deleteTarget?.name ?? '' })}
        description={t('mcp.deleteBody', { config: deleteTarget?.sourceConfig ?? '' })}
        confirmLabel={t('mcp.delete')}
        busy={remove.isPending}
        onConfirm={() => {
          if (!deleteTarget) return
          const target = deleteTarget
          remove.mutate(
            { agentId, serverId: target.id },
            {
              onSuccess: () => {
                toast.success(t('mcp.deleted', { name: target.name }))
                setDeleteTarget(null)
              },
              onError: (error) => {
                toastAppError(error)
                setDeleteTarget(null)
              },
            },
          )
        }}
      />

      {open ? (
        <DocumentEditorDialog
          key={open.path}
          agentId={agentId}
          document={open}
          onOpenChange={() => setOpen(null)}
        />
      ) : null}
    </>
  )
}
