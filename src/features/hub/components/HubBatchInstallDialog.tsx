import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, CircleSlash, TriangleAlert } from 'lucide-react'

import { toAppError } from '@/shared/api/errors'
import { ipc } from '@/shared/api/ipc'
import { queryKeys } from '@/shared/api/keys'
import type { AgentRef } from '@/shared/bindings/AgentRef'
import type { HubEntry } from '@/shared/bindings/HubEntry'
import type { ScanReport } from '@/shared/bindings/ScanReport'
import { ownerName, projectOwner, SHARED_OWNER } from '@/shared/lib/owners'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { OwnerSelect } from '@/shared/ui/OwnerSelect'
import { toast, toastAppError } from '@/shared/ui/Toast'
import { useQueryClient } from '@tanstack/react-query'

import { useAgents, useFavoriteAgents } from '@/features/agents/api/queries'
import { orderByFavorite } from '@/features/agents/lib/favorites'
import { useProjects } from '@/features/projects/api/queries'

import { formatGroupTitle, isBatchable, takenByOwner } from '../lib/grouping'

type ItemStatus = 'pending' | 'skip' | 'running' | 'done' | 'error'

interface ItemState {
  entry: HubEntry
  status: ItemStatus
  error?: string
}

/**
 * Review and install several hub skills for one owner.
 *
 * One confirm covers the whole list: each write still goes through `install_hub_resource` with
 * `confirm: true`, sequentially, so a refusal mid-way leaves the rest to finish and the dialog
 * reports what happened. Skills the chosen owner already holds are marked to skip and never sent.
 */
export function HubBatchInstallDialog({
  entries,
  groupId,
  onClose,
}: {
  entries: HubEntry[]
  /** When the batch is one plugin group, named in the title. */
  groupId?: string | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const agents = useAgents()
  const favoriteIds = useFavoriteAgents()
  const projects = useProjects()

  const owners = useMemo<AgentRef[]>(
    () => [
      SHARED_OWNER,
      ...orderByFavorite(
        (agents.data?.agents ?? [])
          .filter((agent) => agent.status === 'installed')
          .map((agent) => ({ id: agent.id, name: agent.name, icon: agent.icon })),
        favoriteIds,
      ),
      ...(projects.data?.projects ?? []).map(projectOwner),
    ],
    [agents.data, projects.data, favoriteIds],
  )

  const [ownerId, setOwnerId] = useState(owners[0]?.id ?? '')
  const [running, setRunning] = useState(false)
  const [items, setItems] = useState<ItemState[]>(() =>
    entries.filter(isBatchable).map((entry) => ({ entry, status: 'pending' })),
  )

  const withScripts = items.filter((item) => item.entry.hasScripts).length
  const skipCount = items.filter((item) => takenByOwner(item.entry, ownerId)).length
  const todoCount = items.length - skipCount
  const sourceName = items[0]?.entry.sourceName ?? ''
  const progressDone = items.filter(
    (item) => item.status === 'done' || item.status === 'error' || item.status === 'skip',
  ).length
  const finished = running && progressDone === items.length

  const title = groupId
    ? t('hub.batchGroupTitle', { group: formatGroupTitle(groupId) })
    : t('hub.batchTitle')

  const patch = (entryId: string, next: Partial<ItemState>) =>
    setItems((current) =>
      current.map((item) => (item.entry.id === entryId ? { ...item, ...next } : item)),
    )

  const submit = async () => {
    if (!ownerId || todoCount === 0 || running) return
    setRunning(true)

    let installed = 0
    let skipped = 0
    let failed = 0
    let lastReport: ScanReport | null = null

    for (const item of items) {
      if (takenByOwner(item.entry, ownerId)) {
        patch(item.entry.id, { status: 'skip' })
        skipped += 1
        continue
      }
      patch(item.entry.id, { status: 'running' })
      try {
        const result = await ipc.installHubResource({
          ownerId,
          entryId: item.entry.id,
          name: null,
          transport: null,
          confirm: true,
        })
        lastReport = result.report
        patch(item.entry.id, { status: 'done' })
        installed += 1
      } catch (error) {
        failed += 1
        patch(item.entry.id, { status: 'error', error: toAppError(error).message })
        toastAppError(error)
      }
    }

    if (lastReport) {
      client.setQueryData(queryKeys.agents(), lastReport)
      void client.invalidateQueries({ queryKey: queryKeys.library() })
      void client.invalidateQueries({ queryKey: queryKeys.hubSourceAll() })
      void client.invalidateQueries({ queryKey: queryKeys.hubEntryAll() })
    }

    const owner = owners.find((candidate) => candidate.id === ownerId)
    toast.success(
      t('hub.batchDone', {
        installed,
        skipped,
        failed,
        owner: ownerName(owner ?? SHARED_OWNER, t('library.shared')),
      }),
    )
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !running) onClose()
        if (!open && finished) onClose()
      }}
    >
      <DialogContent className="w-[min(640px,94vw)]">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {title}
            <Badge tone="accent">{t('hub.kind.skill')}</Badge>
          </DialogTitle>
          <DialogDescription>
            {t('hub.batchBody', { count: items.length, source: sourceName })}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-5">
          {withScripts > 0 ? (
            <div className="border-warning/40 bg-warning/5 flex items-start gap-2 rounded-lg border p-3">
              <TriangleAlert className="text-warning-fg mt-0.5 size-4 shrink-0" aria-hidden />
              <p className="text-[0.8125rem]">
                {t('hub.batchScriptsWarning', { count: withScripts })}
              </p>
            </div>
          ) : null}

          <OwnerSelect
            label={t('hub.target')}
            hint={t('hub.targetHint')}
            owners={owners}
            value={ownerId}
            onChange={setOwnerId}
          />

          {skipCount > 0 && !running ? (
            <p className="text-muted text-[0.75rem]">
              {t('hub.batchSkipHint', { count: skipCount })}
            </p>
          ) : null}

          <ul className="border-border divide-border flex max-h-72 flex-col divide-y overflow-y-auto rounded-lg border">
            {items.map((item) => {
              const skip = !running && takenByOwner(item.entry, ownerId)
              const status = running ? item.status : skip ? 'skip' : item.status
              return (
                <li
                  key={item.entry.id}
                  className="flex items-start gap-3 px-3 py-2.5 text-[0.8125rem]"
                >
                  <StatusIcon status={status} />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-foreground truncate font-medium">
                        {item.entry.title ?? item.entry.name}
                      </span>
                      {item.entry.hasScripts ? (
                        <Badge tone="warning">{t('hub.scripts')}</Badge>
                      ) : null}
                    </div>
                    {item.error ? (
                      <p className="text-danger-fg text-[0.75rem]">{item.error}</p>
                    ) : status === 'skip' ? (
                      <p className="text-faint text-[0.75rem]">{t('hub.batchSkipped')}</p>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>

          {running ? (
            <p className="text-muted text-[0.75rem] tabular-nums" aria-live="polite">
              {t('hub.batchProgress', { done: progressDone, total: items.length })}
            </p>
          ) : null}
        </DialogBody>

        <div className="border-border flex items-center justify-end gap-2 border-t px-6 py-4">
          <Button variant="ghost" onClick={onClose} disabled={running && !finished}>
            {finished ? t('common.close') : t('common.cancel')}
          </Button>
          {finished ? null : (
            <Button
              variant="primary"
              onClick={() => void submit()}
              disabled={!ownerId || todoCount === 0}
              loading={running}
            >
              {t('hub.batchInstall', { count: todoCount })}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function StatusIcon({ status }: { status: ItemStatus }) {
  if (status === 'done') {
    return <Check className="text-success-fg mt-0.5 size-4 shrink-0" aria-hidden />
  }
  if (status === 'skip') {
    return <CircleSlash className="text-faint mt-0.5 size-4 shrink-0" aria-hidden />
  }
  if (status === 'error') {
    return <TriangleAlert className="text-danger-fg mt-0.5 size-4 shrink-0" aria-hidden />
  }
  if (status === 'running') {
    return (
      <span
        className="border-accent mt-0.5 size-4 shrink-0 animate-spin rounded-full border-2 border-t-transparent"
        aria-hidden
      />
    )
  }
  return <span className="border-border mt-0.5 size-4 shrink-0 rounded-full border" aria-hidden />
}
