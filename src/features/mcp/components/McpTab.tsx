import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Plug, Plus } from 'lucide-react'

import type { AgentRef } from '@/shared/bindings/AgentRef'
import type { ConfigFile } from '@/shared/bindings/ConfigFile'
import type { McpServer } from '@/shared/bindings/McpServer'
import { matchesActivity, type ActivityFilter } from '@/shared/lib/activity'
import { useSessionState } from '@/shared/lib/sessionState'
import { ActivityChips } from '@/shared/ui/ActivityChips'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Button } from '@/shared/ui/Button'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { EmptyState } from '@/shared/ui/EmptyState'
import { FilterBar, FilterRow } from '@/shared/ui/FilterBar'
import { toast, toastAppError } from '@/shared/ui/Toast'

import { DocumentEditorDialog } from '@/features/editor/components/DocumentEditorDialog'
import { configDocument, type EditorDocument } from '@/features/editor/model'
import { HubQuickInstallDialog } from '@/features/hub/components/HubQuickInstallDialog'
import { CloudItemAction, useCloudActions } from '@/features/sync/components/CloudActions'
import { CloudOnlyCard } from '@/features/sync/components/CloudOnlyCard'

import { useDeleteMcpServer, useSetMcpServerEnabled } from '../api/hooks'
import { CreateMcpServerDialog } from './CreateMcpServerDialog'
import { McpCard } from './McpCard'
import { McpDetailDialog } from './McpDetailDialog'

/**
 * MCP servers of one agent, with removal backed by a timestamped backup.
 *
 * A server is only ever defined inside a real file, so the card also offers that file in the
 * editor — read-only when the manifest says so (the CLI-owned `settings.json` of Claude Code,
 * for instance). The entry itself still has to be edited as JSON. Reading the entry — its
 * arguments, environment, headers and the JSON as it stands — belongs to `McpDetailDialog`,
 * which a click on the card opens, exactly as a skill card opens its own detail.
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
  // The cloud half, when the page mounted a provider — the tab is the same list without one.
  const cloud = useCloudActions()
  // Copies of an MCP config file this machine does not hold at all.
  const cloudServers = cloud?.cloudOnly(['mcp']) ?? []
  const [deleteTarget, setDeleteTarget] = useState<McpServer | null>(null)
  // The detail dialog carries a switch, so it keeps the id and reads the live server out of the
  // list the mutation refreshes: a snapshot would leave that switch showing a stale state.
  const [detailId, setDetailId] = useState<string | null>(null)
  const [openConfig, setOpenConfig] = useState<EditorDocument | null>(null)
  // Kept for the session like the skills tab's: the switch is a way of looking at the list, not a
  // property of the agent whose tab it is.
  const [activity, setActivity] = useSessionState<ActivityFilter>('mcp.activity', 'all')
  const [createOpen, setCreateOpen] = useState(false)
  const [hubOpen, setHubOpen] = useState(false)
  // Where a new server comes from: written by hand here, or taken from a collection this machine
  // reads. Both are offered only while the agent can hold one (it is installed).
  const actions = owner ? (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <Button variant="secondary" size="sm" onClick={() => setHubOpen(true)}>
        <Download className="size-3.5" aria-hidden />
        {t('hub.quickInstall')}
      </Button>
      <Button variant="secondary" size="sm" onClick={() => setCreateOpen(true)}>
        <Plus className="size-3.5" aria-hidden />
        {t('mcp.create')}
      </Button>
    </div>
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

  const detail = servers.find((server) => server.id === detailId) ?? null

  if (servers.length === 0 && cloudServers.length === 0) {
    return (
      <>
        <EmptyState
          title={t('mcp.none')}
          hint={owner ? t('mcp.noneHintCreate') : t('mcp.noneHint')}
          icon={Plug}
          action={actions}
        />
        {createOpen && owner ? (
          <CreateMcpServerDialog owners={[owner]} onClose={() => setCreateOpen(false)} />
        ) : null}
        {hubOpen && owner ? (
          <HubQuickInstallDialog kind="mcp" owner={owner} onClose={() => setHubOpen(false)} />
        ) : null}
      </>
    )
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        <FilterBar>
          <FilterRow className="justify-between">
            <ActivityChips items={servers} value={activity} onChange={setActivity} />
            {actions}
          </FilterRow>
        </FilterBar>
        {visible.length === 0 && cloudServers.length === 0 ? (
          <EmptyState
            title={t(activity === 'on' ? 'activity.noneOn' : 'activity.noneOff')}
            hint={t('activity.noneHint')}
            icon={Plug}
          />
        ) : (
          <AnimatedList>
            {visible.map((server) => {
              const item = cloud?.itemAt(server.sourceConfig)
              return (
                <McpCard
                  key={server.id}
                  server={server}
                  sourceDocument={documentFor(server)}
                  onOpen={(target) => setDetailId(target.id)}
                  onOpenConfig={setOpenConfig}
                  onDelete={setDeleteTarget}
                  onToggle={toggleServer}
                  toggleBusy={toggle.isPending && toggle.variables?.serverId === server.id}
                  cloudAction={item ? <CloudItemAction item={item} /> : undefined}
                />
              )
            })}
            {cloudServers.map((copy) => (
              <CloudOnlyCard key={copy.remoteId} remote={copy} />
            ))}
          </AnimatedList>
        )}
      </div>

      {createOpen && owner ? (
        <CreateMcpServerDialog owners={[owner]} onClose={() => setCreateOpen(false)} />
      ) : null}
      {hubOpen && owner ? (
        <HubQuickInstallDialog kind="mcp" owner={owner} onClose={() => setHubOpen(false)} />
      ) : null}

      <McpDetailDialog
        server={detail}
        open={detail !== null}
        onOpenChange={(next) => {
          if (!next) setDetailId(null)
        }}
        sourceDocument={detail ? documentFor(detail) : null}
        onOpenConfig={(document) => {
          setDetailId(null)
          setOpenConfig(document)
        }}
        onDelete={(server) => {
          setDetailId(null)
          setDeleteTarget(server)
        }}
        onToggle={toggleServer}
        toggleBusy={toggle.isPending && toggle.variables?.serverId === detail?.id}
      />

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

      {openConfig ? (
        <DocumentEditorDialog
          key={openConfig.path}
          agentId={agentId}
          document={openConfig}
          onOpenChange={() => setOpenConfig(null)}
        />
      ) : null}
    </>
  )
}
