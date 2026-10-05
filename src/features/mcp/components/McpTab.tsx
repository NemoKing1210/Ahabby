import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plug } from 'lucide-react'

import type { ConfigFile } from '@/shared/bindings/ConfigFile'
import type { McpServer } from '@/shared/bindings/McpServer'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { EmptyState } from '@/shared/ui/EmptyState'
import { toast, toastAppError } from '@/shared/ui/Toast'

import { DocumentEditorDialog } from '@/features/editor/components/DocumentEditorDialog'
import { configDocument, type EditorDocument } from '@/features/editor/model'

import { useDeleteMcpServer } from '../api/hooks'
import { McpCard } from './McpCard'

/**
 * MCP servers of one agent, with removal backed by a timestamped backup.
 *
 * A server is only ever defined inside a real file, so the card also offers that file in the
 * editor — read-only when the manifest says so (the CLI-owned `settings.json` of Claude Code,
 * for instance). The entry itself still has to be edited as JSON.
 */
export function McpTab({
  agentId,
  servers,
  configs,
}: {
  agentId: string
  servers: McpServer[]
  /** Config files of the same agent, used to resolve each server's source file. */
  configs: ConfigFile[]
}) {
  const { t } = useTranslation()
  const remove = useDeleteMcpServer()
  const [deleteTarget, setDeleteTarget] = useState<McpServer | null>(null)
  const [open, setOpen] = useState<EditorDocument | null>(null)

  const documentFor = (server: McpServer): EditorDocument | null => {
    const config = configs.find((candidate) => candidate.path === server.sourceConfig)
    return config ? configDocument(config) : null
  }

  if (servers.length === 0) {
    return <EmptyState title={t('mcp.none')} hint={t('mcp.noneHint')} icon={Plug} />
  }

  return (
    <>
      <AnimatedList>
        {servers.map((server) => (
          <McpCard
            key={server.id}
            server={server}
            sourceDocument={documentFor(server)}
            onOpen={setOpen}
            onDelete={setDeleteTarget}
          />
        ))}
      </AnimatedList>

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
