import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderGit2, Plus, RefreshCw, Trash2 } from 'lucide-react'

import type { Project } from '@/shared/bindings/Project'
import type { ProjectFolderStatus } from '@/shared/bindings/ProjectFolderStatus'
import { fileName, formatRelative } from '@/shared/lib/format'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { EmptyState, ErrorState } from '@/shared/ui/EmptyState'
import { PageHeader } from '@/shared/ui/PageHeader'
import { PathRow } from '@/shared/ui/PathRow'
import { SkeletonList } from '@/shared/ui/Primitives'
import { toast, toastAppError } from '@/shared/ui/Toast'
import { Tooltip } from '@/shared/ui/Tooltip'

import { useScanRefresh } from '@/features/agents/api/scan'

import { useRemoveProjectFolder } from '../api/hooks'
import { useProjects } from '../api/queries'
import { AddProjectFolderDialog } from '../components/AddProjectFolderDialog'
import { ProjectCard } from '../components/ProjectCard'

/** One added folder, its projects and the two bits of state that can be wrong with it. */
function FolderRow({
  status,
  projects,
  onRemove,
}: {
  status: ProjectFolderStatus
  projects: Project[]
  onRemove: (status: ProjectFolderStatus) => void
}) {
  const { t } = useTranslation()
  const directory = status.resolved ?? status.folder.path
  const label = fileName(directory) || directory

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <FolderGit2 className="text-faint size-4 shrink-0" aria-hidden />
        <span className="text-foreground font-serif text-[0.9375rem]">{label}</span>
        {!status.exists ? (
          <Tooltip content={t('projects.missingHint')}>
            <Badge tone="warning">{t('projects.missing')}</Badge>
          </Tooltip>
        ) : null}
        <Badge tone="neutral">{t('projects.projectCount', { count: projects.length })}</Badge>
        <Tooltip content={t('projects.remove')}>
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            aria-label={t('projects.remove')}
            onClick={() => onRemove(status)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </Tooltip>
      </div>

      <PathRow path={directory} />

      {status.problem ? <p className="text-muted text-[0.75rem]">{status.problem}</p> : null}

      {projects.length > 0 ? (
        <AnimatedList>
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </AnimatedList>
      ) : status.exists ? (
        <div className="border-border bg-surface-2/40 rounded-lg border border-dashed px-4 py-6 text-center">
          <p className="text-foreground font-serif text-sm">{t('projects.folderEmpty')}</p>
          <p className="text-muted text-[0.8125rem]">{t('projects.folderEmptyHint')}</p>
        </div>
      ) : null}
    </Card>
  )
}

/**
 * The Projects screen: the folders the user added, and the projects found inside each of them.
 *
 * The folders come from the same cached scan report the agents do — `useProjects` narrows that
 * one query — so adding or removing a folder is reflected in the sidebar count at once.
 */
export function ProjectsPage() {
  const { t, i18n } = useTranslation()
  const { data, isLoading, error, refetch } = useProjects()
  const rescan = useScanRefresh()
  const remove = useRemoveProjectFolder()
  const [addOpen, setAddOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<ProjectFolderStatus | null>(null)

  const scanned = data ? formatRelative(data.scannedAtMs, i18n.language) : null

  return (
    <div className="flex flex-col gap-6">
      <PageHeader className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl">{t('projects.title')}</h1>
          <p className="text-muted text-[0.8125rem]">{t('projects.subtitle')}</p>
          {data ? (
            <p className="text-faint text-[0.75rem]">
              {t('projects.projectCount', { count: data.projects.length })}
              {scanned ? ` · ${t('library.lastScan', { when: scanned })}` : null}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setAddOpen(true)}>
            <Plus className="size-3.5" aria-hidden />
            {t('projects.addFolder')}
          </Button>
          <Button variant="secondary" onClick={rescan.rescan} loading={rescan.isScanning}>
            {rescan.isScanning ? null : <RefreshCw className="size-3.5" aria-hidden />}
            {t('library.rescan')}
          </Button>
        </div>
      </PageHeader>

      {isLoading && !data ? <SkeletonList /> : null}

      {error && !data ? <ErrorState error={error} onRetry={() => void refetch()} /> : null}

      {data && data.folders.length === 0 ? (
        <EmptyState
          icon={FolderGit2}
          title={t('projects.empty')}
          hint={t('projects.emptyHint')}
          action={
            <Button variant="primary" onClick={() => setAddOpen(true)}>
              <Plus className="size-3.5" aria-hidden />
              {t('projects.addFolder')}
            </Button>
          }
        />
      ) : null}

      {data && data.folders.length > 0 ? (
        <div className="flex flex-col gap-4">
          {data.folders.map((status) => (
            <FolderRow
              key={status.folder.id}
              status={status}
              projects={data.projects.filter((project) => project.folderId === status.folder.id)}
              onRemove={setRemoveTarget}
            />
          ))}
        </div>
      ) : null}

      {addOpen ? <AddProjectFolderDialog onClose={() => setAddOpen(false)} /> : null}

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null)
        }}
        title={t('projects.removeTitle', {
          path: removeTarget?.resolved ?? removeTarget?.folder.path ?? '',
        })}
        description={t('projects.removeBody')}
        confirmLabel={t('projects.remove')}
        busy={remove.isPending}
        onConfirm={() => {
          const target = removeTarget
          if (!target) return
          remove.mutate(target.folder.id, {
            onSuccess: () => {
              toast.success(t('projects.removed', { path: target.folder.path }))
              setRemoveTarget(null)
            },
            onError: (removeError) => {
              toastAppError(removeError)
              setRemoveTarget(null)
            },
          })
        }}
      />
    </div>
  )
}
