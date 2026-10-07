import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, Server, Sparkles } from 'lucide-react'

import { ipc } from '@/shared/api/ipc'
import type { HubEntry } from '@/shared/bindings/HubEntry'
import type { HubSource } from '@/shared/bindings/HubSource'
import { formatBytes, isKnownNumber } from '@/shared/lib/format'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { toastAppError } from '@/shared/ui/Toast'
import { Tooltip } from '@/shared/ui/Tooltip'

import { HubContextMenu } from './HubContextMenu'
import { HubTagList } from './HubEntryParts'

/**
 * One installable entry, as a row of the hub.
 *
 * The description is the entry's own text (a publisher's, a repository's, a document's), so it is
 * shown verbatim and clamped rather than summarised. The body opens the preview — reading what a
 * payload *is* costs nothing and writes nothing — while the trailing button goes straight to the
 * install dialog, so browsing and installing each have exactly one affordance. A right click opens
 * the same two, plus the places the card has no room for.
 */
export function HubEntryCard({
  entry,
  source,
  onView,
  onInstall,
  onRefresh,
  refreshing,
}: {
  entry: HubEntry
  source: HubSource
  onView: (entry: HubEntry) => void
  onInstall: (entry: HubEntry) => void
  onRefresh: (entry: HubEntry) => void
  refreshing?: boolean
}) {
  const { t } = useTranslation()
  const size = formatBytes(entry.sizeBytes)
  const Icon = entry.kind === 'skill' ? Sparkles : Server
  const page = entry.homepage ?? entry.repository
  // A label and a number, not a sentence: "3 files" cannot be translated once (Russian needs
  // three plural forms), while "Files 3" is the same string for every count in every language.
  const files = isKnownNumber(entry.fileCount) ? `${t('hub.files')} ${entry.fileCount}` : null
  const values = entry.inputCount > 0 ? `${t('hub.inputs')} ${entry.inputCount}` : null

  // The body is a div rather than a button: a button may not contain the block content the card
  // needs. Enter/Space keep it reachable from the keyboard.
  const activate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onView(entry)
    }
  }

  return (
    <HubContextMenu
      entry={entry}
      source={source}
      onView={onView}
      onInstall={onInstall}
      onRefresh={onRefresh}
      refreshing={refreshing}
    >
      <Card className="hover:border-border-strong ease-warm group transition-[border-color,translate] duration-150 hover:-translate-y-px">
        <div className="flex items-start gap-3 p-4">
          <div
            role="button"
            tabIndex={0}
            aria-label={entry.title ?? entry.name}
            onClick={() => onView(entry)}
            onKeyDown={activate}
            className="focus-visible:outline-ring flex min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <span
              aria-hidden
              className="bg-surface-2 text-muted mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-lg"
            >
              <Icon className="size-4" />
            </span>

            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-foreground group-hover:text-accent-strong text-[0.9375rem] font-medium">
                  {entry.title ?? entry.name}
                </span>
                {entry.version ? <Badge tone="outline">v{entry.version}</Badge> : null}
                {entry.hasScripts ? <Badge tone="warning">{t('hub.scripts')}</Badge> : null}
              </div>

              {entry.description ? (
                <p className="text-muted line-clamp-2 text-[0.8125rem]">{entry.description}</p>
              ) : null}

              <HubTagList entry={entry} />

              {/* Why it cannot be installed is the publisher's own wording: the hub shows it as it is. */}
              {!entry.installable && entry.installProblem ? (
                <p className="text-warning-fg text-[0.75rem]">{entry.installProblem}</p>
              ) : (
                <div className="text-faint flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.75rem]">
                  {files ? <span>{files}</span> : null}
                  {size ? <span>{size}</span> : null}
                  {values ? <span>{values}</span> : null}
                  {entry.license ? <span>{entry.license}</span> : null}
                </div>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {page ? (
              <Tooltip content={t('hub.entryPage')}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('hub.entryPage')}
                  onClick={() => {
                    void ipc.openUrl(page).catch(toastAppError)
                  }}
                >
                  <ExternalLink className="size-3.5" />
                </Button>
              </Tooltip>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              disabled={!entry.installable}
              onClick={() => onInstall(entry)}
            >
              {t('hub.install')}
            </Button>
          </div>
        </div>
      </Card>
    </HubContextMenu>
  )
}
