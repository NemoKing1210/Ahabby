import { useTranslation } from 'react-i18next'
import { ExternalLink } from 'lucide-react'

import { ipc } from '@/shared/api/ipc'
import type { HubEntry } from '@/shared/bindings/HubEntry'
import type { HubFileInfo } from '@/shared/bindings/HubFileInfo'
import { formatBytes, isKnownNumber } from '@/shared/lib/format'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card, KeyValue } from '@/shared/ui/Card'
import { toastAppError } from '@/shared/ui/Toast'
import { Tooltip } from '@/shared/ui/Tooltip'

/**
 * The pieces an entry is shown with, shared by the preview and the install dialog.
 *
 * Both dialogs answer the same question about the same thing — what is this, and what would it
 * write — so the answer is rendered once. What differs is what comes after it: nothing for a
 * preview, and the target, the values and the confirmation for an install.
 */

/** A link out of Ahabby, opened in the OS browser with the URL as its tooltip. */
function HubLink({ label, href }: { label: string; href: string | null | undefined }) {
  if (!href) return null
  return (
    <Tooltip content={href}>
      <Button
        variant="ghost"
        size="sm"
        aria-label={href}
        onClick={() => {
          void ipc.openUrl(href).catch(toastAppError)
        }}
      >
        <ExternalLink className="size-3.5" aria-hidden />
        {label}
      </Button>
    </Tooltip>
  )
}

/** Every place the entry itself can be read, without repeating a URL twice. */
export function HubEntryLinks({ entry, docs }: { entry: HubEntry; docs?: string | null }) {
  const { t } = useTranslation()
  const page = entry.homepage ?? entry.repository
  return (
    <div className="flex flex-wrap items-center gap-2">
      <HubLink label={entry.homepage ? t('hub.homepage') : t('hub.repository')} href={page} />
      {docs && docs !== page ? <HubLink label={t('hub.docs')} href={docs} /> : null}
    </div>
  )
}

/**
 * What an entry is *for* — `documents`, `design`, `review` — so a collection of hundreds can be
 * browsed by subject.
 *
 * The tags are the publisher's and the source file's own words, shown verbatim: they are the same
 * strings the toolbar filters by, so translating them would break the one link between the two.
 */
export function HubTagList({ entry }: { entry: HubEntry }) {
  if (entry.tags.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {entry.tags.map((tag) => (
        <Badge key={tag} tone="outline">
          {tag}
        </Badge>
      ))}
    </div>
  )
}

/** Who publishes an entry, under which licence, how big it is, and which collection it came from. */
export function HubEntryMeta({ entry }: { entry: HubEntry }) {
  const { t } = useTranslation()
  return (
    <Card className="px-5 py-2">
      <dl className="grid grid-cols-2 gap-x-6 sm:grid-cols-3">
        {entry.version ? <KeyValue label={t('hub.version')}>{entry.version}</KeyValue> : null}
        {entry.vendor ? <KeyValue label={t('hub.vendor')}>{entry.vendor}</KeyValue> : null}
        {entry.license ? <KeyValue label={t('hub.license')}>{entry.license}</KeyValue> : null}
        {isKnownNumber(entry.fileCount) ? (
          <KeyValue label={t('hub.files')}>{entry.fileCount}</KeyValue>
        ) : null}
        {isKnownNumber(entry.sizeBytes) ? (
          <KeyValue label={t('hub.size')}>{formatBytes(entry.sizeBytes)}</KeyValue>
        ) : null}
        <KeyValue label={t('hub.source')}>{entry.sourceName}</KeyValue>
        {entry.inputCount > 0 ? (
          <KeyValue label={t('hub.inputs')}>{entry.inputCount}</KeyValue>
        ) : null}
      </dl>

      {entry.tags.length > 0 ? (
        <div className="border-border mt-2 flex flex-wrap items-center gap-2 border-t pt-2">
          <span className="text-faint text-[0.75rem]">{t('hub.tags')}</span>
          <HubTagList entry={entry} />
        </div>
      ) : null}
    </Card>
  )
}

/**
 * The files an install would write, with the one distinction that matters before a write: which
 * of them an agent may run.
 */
export function HubFileList({ files }: { files: HubFileInfo[] }) {
  const { t } = useTranslation()
  return (
    <ul className="border-border bg-surface-2/40 max-h-56 divide-y overflow-y-auto rounded-lg border">
      {files.map((file) => (
        <li key={file.path} className="flex items-center gap-3 px-3 py-1.5">
          <span className="text-foreground min-w-0 flex-1 truncate font-mono text-[0.75rem]">
            {file.path}
          </span>
          {file.kind === 'text' ? null : (
            <Badge tone={file.kind === 'script' ? 'warning' : 'neutral'}>
              {t(`hub.fileKind.${file.kind}`)}
            </Badge>
          )}
          <span className="text-faint w-16 shrink-0 text-right text-[0.6875rem] tabular-nums">
            {formatBytes(file.sizeBytes)}
          </span>
        </li>
      ))}
    </ul>
  )
}
