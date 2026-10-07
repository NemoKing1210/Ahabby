import { useTranslation } from 'react-i18next'
import { Check, CircleSlash, ExternalLink, RefreshCw } from 'lucide-react'

import type { HubEntry } from '@/shared/bindings/HubEntry'
import type { HubEntryInstall } from '@/shared/bindings/HubEntryInstall'
import type { HubFileInfo } from '@/shared/bindings/HubFileInfo'
import { cn } from '@/shared/lib/cn'
import { formatBytes, isKnownNumber } from '@/shared/lib/format'
import { tagColor } from '@/shared/lib/tagColor'
import { AgentTag } from '@/shared/ui/AgentTag'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card, KeyValue } from '@/shared/ui/Card'
import { FormField } from '@/shared/ui/FormField'
import { Tooltip } from '@/shared/ui/Tooltip'

import { useBrowser } from '@/features/browser/context'

/**
 * The pieces an entry is shown with, shared by the preview and the install dialog.
 *
 * Both dialogs answer the same question about the same thing — what is this, and what would it
 * write — so the answer is rendered once. What differs is what comes after it: nothing for a
 * preview, and the target, the values and the confirmation for an install.
 */

/**
 * What one existing copy is worth saying about it: switched off, no longer what the collection
 * publishes, or the same bytes it publishes — and nothing at all when the two could not be
 * compared.
 *
 * The claim is never invented: `identical` is set by the backend from the payload itself (a
 * skill's `SKILL.md`, a server's launch recipe), so a card can only say "this is the same thing"
 * when it actually compared them.
 */
function InstallState({ install }: { install: HubEntryInstall }) {
  const { t } = useTranslation()

  const state = !install.enabled
    ? { icon: CircleSlash, tone: 'text-faint', label: t('hub.installedOff') }
    : install.identical === false
      ? { icon: RefreshCw, tone: 'text-warning-fg', label: t('hub.installedDiffers') }
      : install.identical === true
        ? { icon: Check, tone: 'text-success-fg', label: t('hub.installedSame') }
        : null

  if (!state) return null
  const Icon = state.icon
  return (
    <Tooltip content={state.label}>
      <Icon className={cn('size-3 shrink-0', state.tone)} role="img" aria-label={state.label} />
    </Tooltip>
  )
}

/**
 * Where an entry already is, as a row of owner chips — what a card shows in its own width.
 *
 * The owners come from the scan, never from the Hub's memory of what *it* installed: a skill
 * written into an agent's directory is that agent's skill whoever put it there, so a copy made in
 * the Library, in another agent's page or by hand is named here just the same.
 */
export function HubInstalled({ entry }: { entry: HubEntry }) {
  const { t } = useTranslation()
  if (entry.installed.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge tone="success">
        <Check className="size-3" aria-hidden />
        {t('hub.installedBadge')}
      </Badge>
      {entry.installed.map((install) => (
        <span
          key={`${install.owner.id}:${install.path}`}
          className="inline-flex items-center gap-1"
        >
          <AgentTag agent={install.owner} title={install.path} className="max-w-44" />
          <InstallState install={install} />
        </span>
      ))}
    </div>
  )
}

/**
 * The same answer with room to read it: one line per copy, naming where it lives.
 *
 * The dialogs use this: a decision about installing a second copy is made with the existing ones
 * in sight, and the path is what makes "for that project, in this directory" checkable.
 */
export function HubInstalledList({ entry }: { entry: HubEntry }) {
  const { t } = useTranslation()
  if (entry.installed.length === 0) return null

  return (
    <FormField label={t('hub.alreadyInstalled')} hint={t('hub.alreadyInstalledHint')}>
      <ul className="border-border bg-surface-2/40 flex flex-col divide-y rounded-lg border">
        {entry.installed.map((install) => (
          <li
            key={`${install.owner.id}:${install.path}`}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2"
          >
            <AgentTag agent={install.owner} />
            <InstallState install={install} />
            <code
              className="text-faint min-w-0 flex-1 truncate font-mono text-[0.7rem]"
              title={install.path}
            >
              {install.path}
            </code>
          </li>
        ))}
      </ul>
    </FormField>
  )
}

/** A link out of Ahabby, opened in Ahabby's own browser with the URL as its tooltip. */
function HubLink({ label, href }: { label: string; href: string | null | undefined }) {
  const browser = useBrowser()
  if (!href) return null
  return (
    <Tooltip content={href}>
      <Button variant="ghost" size="sm" aria-label={href} onClick={() => browser.open(href)}>
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
 * Each one wears its own colour — the same hue on the card, in the filter row and in every dialog,
 * because the colour is hashed out of the tag's name rather than assigned by position.
 */
export function HubTagList({ entry }: { entry: HubEntry }) {
  if (entry.tags.length === 0) return null
  return (
    <AnimatedList grouped={false} className="flex flex-wrap items-center gap-1.5">
      {entry.tags.map((tag) => (
        <Badge key={tag} tone="outline" className="ah-tag" style={tagColor(tag)}>
          {tag}
        </Badge>
      ))}
    </AnimatedList>
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
    <AnimatedList
      as="ul"
      grouped={false}
      className="border-border bg-surface-2/40 max-h-56 divide-y overflow-y-auto rounded-lg border"
    >
      {files.map((file) => (
        <div key={file.path} className="flex items-center gap-3 px-3 py-1.5">
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
        </div>
      ))}
    </AnimatedList>
  )
}
