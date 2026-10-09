import { useTranslation } from 'react-i18next'

import type { RemoteItem } from '@/shared/bindings/RemoteItem'
import { formatBytes } from '@/shared/lib/format'
import { Badge } from '@/shared/ui/Badge'
import { Card } from '@/shared/ui/Card'

import { CloudRemoteAction } from './CloudActions'

/**
 * A file the cloud holds and this machine does not: a declared config that was never created
 * here, or a copy restored to a fresh machine. It wears the dashed outline a missing config uses,
 * so a tab reads as "this exists, just not here" rather than as an error, and Restore is the one
 * action on it.
 */
export function CloudOnlyCard({ remote }: { remote: RemoteItem }) {
  const { t } = useTranslation()
  const size = formatBytes(remote.sizeBytes)

  return (
    <Card className="border-border-strong bg-surface-2/40 flex flex-col gap-3 border-dashed p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-foreground text-sm">{remote.label || remote.name}</span>
            <Badge tone="outline">{t(`sync.kind.${remote.kind}`)}</Badge>
            {remote.hasSecrets ? <Badge tone="warning">{t('sync.secretBadge')}</Badge> : null}
          </div>
          <p className="text-muted text-[0.75rem]">{t('sync.noLocalCopy')}</p>
        </div>

        <CloudRemoteAction remote={remote} />
      </div>

      <div className="text-faint flex flex-wrap items-center gap-3 font-mono text-[0.75rem]">
        <span className="truncate">{remote.relativePath || remote.key}</span>
        {size ? <span className="font-sans">{size}</span> : null}
        <span className="font-sans">{t('sync.filesShort', { count: remote.files })}</span>
      </div>
    </Card>
  )
}
