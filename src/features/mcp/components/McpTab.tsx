import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plug } from 'lucide-react'

import type { McpServer } from '@/shared/bindings/McpServer'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { EmptyState } from '@/shared/ui/EmptyState'
import { toast, toastAppError } from '@/shared/ui/Toast'

import { useDeleteMcpServer } from '../api/hooks'
import { McpCard } from './McpCard'

/** MCP servers of one agent, with removal backed by a timestamped backup. */
export function McpTab({ agentId, servers }: { agentId: string; servers: McpServer[] }) {
  const { t } = useTranslation()
  const remove = useDeleteMcpServer()
  const [deleteTarget, setDeleteTarget] = useState<McpServer | null>(null)

  if (servers.length === 0) {
    return <EmptyState title={t('mcp.none')} hint={t('mcp.noneHint')} icon={Plug} />
  }

  return (
    <>
      <AnimatedList className="flex flex-col gap-3">
        {servers.map((server) => (
          <McpCard key={server.id} server={server} onDelete={setDeleteTarget} />
        ))}
      </AnimatedList>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
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
    </>
  )
}
