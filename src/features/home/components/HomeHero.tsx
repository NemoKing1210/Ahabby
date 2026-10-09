import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { Os } from '@/shared/bindings/Os'
import type { ScanReport } from '@/shared/bindings/ScanReport'
import { formatDuration, formatRelative } from '@/shared/lib/format'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Spinner } from '@/shared/ui/Primitives'
import { AhabbyLogo } from '@/shared/ui/AhabbyLogo'

import { useScanRefresh } from '@/features/agents/api/scan'

/** Proper names of the host systems: never translated. */
const OS_LABEL: Record<Os, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
}

/**
 * The front door: what the program is, which machine it just scanned, and the scan it can
 * start again. The scan line is the same one the sidebar footer shows, from the same state,
 * so the two can never disagree about when the data is from.
 */
export function HomeHero({ report }: { report: ScanReport | undefined }) {
  const { t, i18n } = useTranslation()
  const { rescan, isScanning, progress } = useScanRefresh()

  const when = report ? formatRelative(report.scannedAtMs, i18n.language) : null
  const duration = report ? formatDuration(report.durationMs) : null
  const scanLine = isScanning
    ? progress.total > 0
      ? t('agents.refreshingProgress', { done: progress.done, total: progress.total })
      : t('agents.refreshing')
    : when && duration
      ? t('agents.lastScan', { when, duration })
      : t('agents.neverScanned')

  return (
    <Card className="relative overflow-hidden">
      {/* One warm wash behind the mark, the way the splash lifts it off the background. */}
      <span
        aria-hidden
        className="bg-accent/10 pointer-events-none absolute -top-24 -left-16 size-72 rounded-full blur-3xl"
      />
      <div className="relative flex flex-col gap-6 p-6">
        <div className="flex flex-wrap items-start gap-x-5 gap-y-4">
          <AhabbyLogo className="size-16 rounded-[22%]" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl">Ahabby</h1>
              <Badge tone="neutral" className="font-mono tabular-nums">
                v{__APP_VERSION__}
              </Badge>
              {report ? <Badge tone="outline">{OS_LABEL[report.os]}</Badge> : null}
            </div>
            <p className="text-foreground max-w-[46ch] font-serif text-lg leading-snug">
              {t('home.tagline')}
            </p>
            <p className="text-muted max-w-[68ch] text-[0.8125rem]">{t('home.intro')}</p>
          </div>
        </div>

        <div className="border-border flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-faint flex items-center gap-2 text-[0.75rem] tabular-nums">
            {isScanning ? <Spinner className="size-3" /> : null}
            {scanLine}
          </p>
          <Button
            variant="secondary"
            size="sm"
            data-tour="home-scan"
            onClick={rescan}
            loading={isScanning}
          >
            {isScanning ? null : <RefreshCw className="size-3.5" aria-hidden />}
            {t('agents.rescan')}
          </Button>
        </div>
      </div>
    </Card>
  )
}
