import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff } from 'lucide-react'

import type { EnvVar } from '@/shared/bindings/EnvVar'
import { Button } from '@/shared/ui/Button'
import { toastAppError } from '@/shared/ui/Toast'

import { useRevealSecret } from '../api/hooks'

/**
 * One `env` or `headers` entry.
 *
 * Masked values arrive from the backend **without** their content (`value: null`), so
 * showing one requires an explicit click that asks the backend for that single key.
 */
export function SecretValue({
  agentId,
  serverId,
  entry,
}: {
  agentId: string
  serverId: string
  entry: EnvVar
}) {
  const { t } = useTranslation()
  const reveal = useRevealSecret()
  const [shown, setShown] = useState<string | null>(null)

  if (!entry.masked) {
    return (
      <div className="flex items-baseline gap-2 font-mono text-[0.75rem]">
        <span className="text-muted">{entry.key}</span>
        <span className="text-foreground break-all">{entry.value ?? ''}</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 font-mono text-[0.75rem]">
      <span className="text-muted">{entry.key}</span>
      <span className="text-foreground break-all">{shown ?? '•'.repeat(8)}</span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={shown ? t('mcp.hide') : t('mcp.reveal')}
        loading={reveal.isPending}
        onClick={() => {
          if (shown) {
            setShown(null)
            return
          }
          reveal.mutate(
            { agentId, serverId, key: entry.key },
            {
              onSuccess: (value) => setShown(value),
              onError: (error) => toastAppError(error, 'mcp.revealFailed'),
            },
          )
        }}
      >
        {reveal.isPending ? null : shown ? (
          <EyeOff className="size-3.5" />
        ) : (
          <Eye className="size-3.5" />
        )}
      </Button>
    </div>
  )
}
