import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, StopCircle, Terminal, XCircle } from 'lucide-react'

import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { Badge } from '@/shared/ui/Badge'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { Spinner } from '@/shared/ui/Primitives'
import { toastAppError } from '@/shared/ui/Toast'

import { useCancelJob } from '../api/mutations'
import { useJobStore } from '../store'

const STREAM_CLASS: Record<string, string> = {
  stdout: 'text-foreground',
  stderr: 'text-danger-fg',
  system: 'text-muted',
}

/**
 * Live output of one install/update job.
 *
 * Output arrives through `job://output` events (subscribed once in `app/providers.tsx`) and
 * is rendered from the Zustand store, so the console survives navigation.
 */
export function JobConsole({ jobId, className }: { jobId: string; className?: string }) {
  const { t } = useTranslation()
  const job = useJobStore((state) => state.jobs[jobId])
  const cancel = useCancelJob()
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = scrollRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [job?.lines.length])

  if (!job) return null

  const running = !job.outcome

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-muted flex items-center gap-2 text-[0.75rem]">
          <Terminal className="size-3.5" aria-hidden />
          <span className="font-mono break-all">{job.command}</span>
        </div>
        {running ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={cancel.isPending}
            onClick={() => setConfirmingCancel(true)}
          >
            <StopCircle className="size-3.5" aria-hidden />
            {t('install.cancel')}
          </Button>
        ) : (
          <Badge
            tone={job.outcome?.ok ? 'success' : job.outcome?.cancelled ? 'neutral' : 'danger'}
            dot={job.outcome?.ok ? 'success' : 'danger'}
          >
            {job.outcome?.cancelled
              ? t('common.cancel')
              : job.outcome && job.outcome.exitCode !== null
                ? t('install.exitCode', { code: job.outcome.exitCode })
                : t('errors.other')}
          </Badge>
        )}
      </div>

      <div
        ref={scrollRef}
        className="border-border bg-surface-2 max-h-72 min-h-32 overflow-y-auto rounded-lg border p-3 font-mono text-[0.75rem] leading-relaxed"
        role="log"
        aria-live="polite"
      >
        {job.lines.length === 0 ? (
          <div className="text-muted flex items-center gap-2">
            <Spinner />
            {t('install.waiting')}
          </div>
        ) : (
          job.lines.map((line, index) => (
            <div
              key={index}
              className={cn('break-all whitespace-pre-wrap', STREAM_CLASS[line.stream])}
            >
              {line.line}
            </div>
          ))
        )}
      </div>

      {job.outcome ? (
        <div className="flex items-center gap-2 text-[0.8125rem]">
          {job.outcome.ok ? (
            <CheckCircle2 className="text-success-fg size-4" aria-hidden />
          ) : (
            <XCircle className="text-danger-fg size-4" aria-hidden />
          )}
          <span className="text-muted">
            {job.outcome.ok
              ? t('install.succeeded', { agent: job.agentId })
              : job.outcome.cancelled
                ? t('install.cancelled', { agent: job.agentId })
                : (job.outcome.message ?? t('install.failed', { agent: job.agentId }))}
          </span>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmingCancel}
        onOpenChange={(open) => {
          if (!open) setConfirmingCancel(false)
        }}
        title={t('install.cancelJobTitle')}
        description={t('install.cancelJobBody')}
        confirmLabel={t('install.cancel')}
        busy={cancel.isPending}
        onConfirm={() => {
          cancel.mutate(jobId, {
            onSuccess: () => setConfirmingCancel(false),
            onError: (error) => {
              setConfirmingCancel(false)
              toastAppError(error)
            },
          })
        }}
      />
    </div>
  )
}
