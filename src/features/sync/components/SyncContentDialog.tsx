import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, FileText, GitCompare } from 'lucide-react'

import type { SyncContent } from '@/shared/bindings/SyncContent'
import type { SyncContentSide } from '@/shared/bindings/SyncContentSide'
import { formatBytes } from '@/shared/lib/format'
import { AgentTag } from '@/shared/ui/AgentTag'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { CodeViewer } from '@/shared/ui/CodeViewer'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  ScrollArea,
} from '@/shared/ui/Dialog'
import { EmptyState, ErrorState } from '@/shared/ui/EmptyState'
import { Spinner } from '@/shared/ui/Primitives'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/Tabs'
import { Timestamp } from '@/shared/ui/Timestamp'
import { useBrowser } from '@/features/browser/context'

import { useRemoteSyncContent, useSyncItemContent } from '../api/hooks'
import { fileFormat } from '../lib/fileFormat'
import type { SyncViewTarget } from '../lib/targets'
import { SyncFileList } from './SyncFileList'

/**
 * One item's files, read-only.
 *
 * The whole point is to answer "what is actually in there?" before deciding anything: a skill's
 * files are listed and one is shown with syntax highlighting, a binary file is named by its size
 * instead of decoded into nonsense, and a file the reader cut says so. When both sides exist they
 * are a two-tab switch — the secondary tab row, the same kind of level the library uses — and a
 * copy this machine does not hold simply opens on the cloud side.
 */
export function SyncContentDialog({
  target,
  onCompare,
  onClose,
}: {
  target: SyncViewTarget
  /** Opens the comparison, when the caller wired one. */
  onCompare?: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const browser = useBrowser()
  const { owner, ownerId, name, kind, itemId, remoteId } = target
  const [side, setSide] = useState<SyncContentSide>(target.side)
  const [localPath, setLocalPath] = useState<string | null>(null)
  const [remotePath, setRemotePath] = useState<string | null>(null)

  const hasLocal = itemId !== null
  const hasRemote = remoteId !== null
  // With one side only there is nothing to switch, so the target decides.
  const current: SyncContentSide = hasLocal && hasRemote ? side : hasLocal ? 'local' : 'remote'
  const local = useSyncItemContent(ownerId, itemId, current === 'local')
  const remote = useRemoteSyncContent(remoteId, current === 'remote')
  const uri = local.data?.uri ?? remote.data?.uri ?? null

  /** One side's pane: its file list, when it holds more than one, and the selected file. */
  const pane = (
    content: SyncContent | undefined,
    query: { isPending: boolean; error: unknown; refetch: () => void },
    selected: string | null,
    onSelect: (path: string) => void,
  ) => {
    if (query.isPending) {
      return (
        <div className="text-muted flex flex-1 items-center justify-center gap-2 text-[0.8125rem]">
          <Spinner /> {t('common.loading')}
        </div>
      )
    }
    if (query.error) {
      return <ErrorState error={query.error} onRetry={() => query.refetch()} />
    }
    if (!content || !content.exists || content.files.length === 0) {
      return (
        <EmptyState
          icon={FileText}
          title={t('sync.contentMissing')}
          hint={current === 'remote' ? t('sync.contentMissingCloud') : t('sync.contentMissingDisk')}
        />
      )
    }

    const file = content.files.find((entry) => entry.path === selected) ?? content.files[0]
    if (!file) return null
    const size = formatBytes(file.sizeBytes)

    return (
      <div className="flex min-h-0 flex-1 gap-3">
        {content.files.length > 1 ? (
          <ScrollArea className="border-border w-64 shrink-0 border-r pr-2">
            <SyncFileList
              files={content.files}
              selected={file.path}
              onSelect={onSelect}
              className="pr-1"
            />
          </ScrollArea>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <code className="min-w-0 truncate font-mono text-[0.75rem]">{file.path}</code>
            <span className="text-faint flex shrink-0 items-center gap-2 text-[0.6875rem]">
              <Timestamp modifiedMs={content.modifiedMs} />
              {size ? <span className="tabular-nums">{size}</span> : null}
            </span>
          </div>

          {file.binary ? (
            <p className="border-border text-muted rounded-lg border border-dashed px-4 py-8 text-center text-[0.8125rem]">
              {t('sync.fileBinary', { size: size ?? '' })}
            </p>
          ) : (
            <>
              {file.truncated ? (
                <p className="text-warning-fg text-[0.75rem]">
                  {t('sync.fileTruncated', { size: size ?? '' })}
                </p>
              ) : null}
              <CodeViewer
                className="min-h-0 flex-1"
                value={file.text ?? ''}
                format={fileFormat(file.path)}
                height="100%"
                wrap
                ariaLabel={file.path}
              />
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="flex h-[85vh] w-[min(1100px,96vw)] flex-col">
        <DialogHeader className="pb-3">
          <DialogTitle className="truncate">{name}</DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>{t('sync.contentHint')}</span>
              <AgentTag agent={owner} />
              <Badge tone="neutral">{t(`sync.kind.${kind}`)}</Badge>
              {uri ? (
                <Button variant="link" size="sm" onClick={() => browser.open(uri)}>
                  <ExternalLink className="size-3.5" aria-hidden />
                  {t('sync.openInGitHub')}
                </Button>
              ) : null}
            </div>
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex min-h-0 flex-1 flex-col overflow-hidden pt-0">
          {hasLocal && hasRemote ? (
            <Tabs
              value={current}
              onValueChange={(value) => setSide(value as SyncContentSide)}
              className="flex min-h-0 flex-1 flex-col"
            >
              <TabsList variant="secondary" className="mb-3 self-start">
                <TabsTrigger value="local">{t('sync.sideLocal')}</TabsTrigger>
                <TabsTrigger value="remote">{t('sync.sideRemote')}</TabsTrigger>
              </TabsList>
              <TabsContent value="local" className="flex min-h-0 flex-1 flex-col">
                {pane(local.data, local, localPath, setLocalPath)}
              </TabsContent>
              <TabsContent value="remote" className="flex min-h-0 flex-1 flex-col">
                {pane(remote.data, remote, remotePath, setRemotePath)}
              </TabsContent>
            </Tabs>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              {current === 'local'
                ? pane(local.data, local, localPath, setLocalPath)
                : pane(remote.data, remote, remotePath, setRemotePath)}
            </div>
          )}
        </DialogBody>

        <div className="border-border flex items-center justify-end gap-2 border-t px-6 py-4">
          {onCompare && remoteId ? (
            <Button variant="secondary" onClick={onCompare}>
              <GitCompare className="size-3.5" aria-hidden />
              {t('sync.compare')}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
