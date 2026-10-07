import { useTranslation } from 'react-i18next'
import { Download, RefreshCw, TriangleAlert } from 'lucide-react'

import type { HubEntry } from '@/shared/bindings/HubEntry'
import type { HubEntryDetail } from '@/shared/bindings/HubEntryDetail'
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
import { EmptyState, ErrorState } from '@/shared/ui/EmptyState'
import { FormField } from '@/shared/ui/FormField'
import { Markdown } from '@/shared/ui/Markdown'
import { SkeletonList } from '@/shared/ui/Primitives'

import { useHubEntry } from '../api/queries'
import { HubEntryLinks, HubEntryMeta, HubFileList } from './HubEntryParts'

/**
 * What one entry *is*, before anything is asked of the user: the instructions themselves, the
 * files they come with, or how the server is launched.
 *
 * Read-only on purpose. The install dialog is where a target and values are chosen and where the
 * write is confirmed; this is the place to *read*, and it deliberately has no form in it. Opening
 * an entry reads the collection it belongs to (and, for an entry of an `index` source, the
 * repository that entry names) — nothing is written, and nothing that is not needed to show the
 * entry is fetched.
 */
export function HubEntryDialog({
  entryId,
  onClose,
  onInstall,
  onRefresh,
  refreshing,
}: {
  entryId: string
  onClose: () => void
  onInstall: (entry: HubEntry) => void
  onRefresh: (entry: HubEntry) => void
  refreshing?: boolean
}) {
  const { t } = useTranslation()
  const detail = useHubEntry(entryId)

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="w-[min(880px,94vw)]">
        {detail.isPending ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('hub.view')}</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <SkeletonList rows={3} />
            </DialogBody>
          </>
        ) : detail.isError || !detail.data ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('hub.view')}</DialogTitle>
              <DialogDescription>{t('hub.entryFailed')}</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
            </DialogBody>
          </>
        ) : (
          <EntryView
            key={entryId}
            detail={detail.data}
            onClose={onClose}
            onInstall={onInstall}
            onRefresh={onRefresh}
            refreshing={refreshing}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function EntryView({
  detail,
  onClose,
  onInstall,
  onRefresh,
  refreshing,
}: {
  detail: HubEntryDetail
  onClose: () => void
  onInstall: (entry: HubEntry) => void
  onRefresh: (entry: HubEntry) => void
  refreshing?: boolean
}) {
  const { t } = useTranslation()
  const entry = detail.entry
  const preview = detail.preview
  const scripts = detail.files.filter((file) => file.kind === 'script')
  const transport = detail.transport

  return (
    <>
      <DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <DialogTitle>{entry.title ?? entry.name}</DialogTitle>
          <Badge tone={entry.kind === 'skill' ? 'accent' : 'info'}>
            {t(`hub.kind.${entry.kind}`)}
          </Badge>
          {entry.hasScripts ? <Badge tone="warning">{t('hub.scripts')}</Badge> : null}
        </div>
        <DialogDescription>{t('hub.viewBody', { source: entry.sourceName })}</DialogDescription>
      </DialogHeader>

      <DialogBody className="flex flex-col gap-5">
        {entry.description ? (
          <p className="text-muted text-[0.8125rem] whitespace-pre-line">{entry.description}</p>
        ) : null}

        <HubEntryMeta entry={entry} />
        <HubEntryLinks entry={entry} docs={detail.sourceUrl} />

        {scripts.length > 0 ? (
          <div className="border-warning/40 bg-warning/5 flex items-start gap-2 rounded-lg border p-3">
            <TriangleAlert className="text-warning-fg mt-0.5 size-4 shrink-0" aria-hidden />
            <p className="text-[0.8125rem]">{t('hub.scriptsWarning')}</p>
          </div>
        ) : null}

        {entry.kind === 'skill' ? (
          <>
            <FormField label={t('hub.writesFiles')} hint={t('hub.writesFilesHint')}>
              <HubFileList files={detail.files} />
            </FormField>

            <div className="flex flex-col gap-2">
              <span className="text-faint text-[0.6875rem] tracking-wide uppercase">
                {t('hub.instructions')}
              </span>
              {preview ? (
                <>
                  {preview.truncated ? (
                    <p className="text-warning-fg text-[0.75rem]">{t('hub.previewTruncated')}</p>
                  ) : null}
                  {preview.frontmatter.length > 0 ? (
                    <dl className="border-border grid grid-cols-[minmax(120px,auto)_1fr] gap-x-4 gap-y-1 rounded-lg border p-3">
                      {preview.frontmatter.map((row) => (
                        <div key={row.key} className="contents">
                          <dt className="text-muted font-mono text-[0.75rem]">{row.key}</dt>
                          <dd className="text-foreground text-[0.75rem] break-words">
                            {row.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                  <Markdown source={preview.content} />
                </>
              ) : (
                <EmptyState title={t('hub.noPreview')} hint={t('hub.noPreviewHint')} />
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <span className="text-faint text-[0.6875rem] tracking-wide uppercase">
                {t('hub.launch')}
              </span>
              <div className="border-border bg-surface-2/40 rounded-lg border p-3">
                {transport?.type === 'stdio' ? (
                  <code className="text-foreground font-mono text-[0.75rem] break-all">
                    {[transport.command, ...transport.args].join(' ')}
                  </code>
                ) : transport?.type === 'http' ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <code className="text-foreground font-mono text-[0.75rem] break-all">
                      {transport.url}
                    </code>
                    <Badge tone="info">{transport.protocol}</Badge>
                  </span>
                ) : (
                  <span className="text-muted text-[0.75rem]">
                    {entry.installProblem ?? t('hub.noRecipe')}
                  </span>
                )}
              </div>
            </div>

            {detail.inputs.length > 0 ? (
              <div className="flex flex-col gap-2">
                <span className="text-faint text-[0.6875rem] tracking-wide uppercase">
                  {t('hub.inputs')}
                </span>
                <ul className="flex flex-col gap-1.5">
                  {detail.inputs.map((input) => (
                    <li key={input.key} className="flex flex-wrap items-baseline gap-2">
                      <code className="text-foreground font-mono text-[0.75rem]">{input.key}</code>
                      {input.required ? <Badge tone="warning">{t('hub.required')}</Badge> : null}
                      {input.secret ? <Badge tone="neutral">{t('hub.secret')}</Badge> : null}
                      {input.description ? (
                        <span className="text-muted text-[0.75rem]">{input.description}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </DialogBody>

      <div className="border-border flex flex-wrap items-center gap-2 border-t px-6 py-4">
        <Button
          variant="ghost"
          size="sm"
          className="mr-auto"
          loading={refreshing}
          onClick={() => onRefresh(entry)}
        >
          {refreshing ? null : <RefreshCw className="size-3.5" aria-hidden />}
          {t('hub.refreshEntry')}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {t('common.close')}
        </Button>
        <Button variant="primary" disabled={!entry.installable} onClick={() => onInstall(entry)}>
          <Download className="size-3.5" aria-hidden />
          {t('hub.install')}
        </Button>
      </div>
    </>
  )
}
