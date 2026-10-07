import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, ExternalLink, Eye, EyeOff } from 'lucide-react'

import type { Agent } from '@/shared/bindings/Agent'
import type { ConfigFact } from '@/shared/bindings/ConfigFact'
import { copyText } from '@/shared/lib/clipboard'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { toast, toastAppError } from '@/shared/ui/Toast'
import { Tooltip } from '@/shared/ui/Tooltip'

import { useBrowser } from '@/features/browser/context'

import { useRevealConfigFact } from '../api/queries'

/**
 * "Quick info": the few values a user wants at a glance, lifted out of the agent's own
 * config files during the scan — default model, provider, endpoints, proxy and credentials.
 *
 * Credentials arrive already masked; showing a real one takes an explicit click that asks
 * the backend for that single value, exactly like an MCP secret does.
 */
export function AgentFactsCard({ agent }: { agent: Agent }) {
  const { t } = useTranslation()

  if (agent.facts.length === 0) return null

  // Group by source file: several values from one config belong together, and the file is
  // what tells the user where to go and change them.
  const groups: { key: string; label: string; path: string; facts: ConfigFact[] }[] = []
  for (const fact of agent.facts) {
    const key = `${fact.configId}:${fact.configPath}`
    const group = groups.find((candidate) => candidate.key === key)
    if (group) {
      group.facts.push(fact)
    } else {
      groups.push({ key, label: fact.configLabel, path: fact.configPath, facts: [fact] })
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-[0.9375rem]">{t('agent.facts.title')}</h3>
        <p className="text-muted text-[0.75rem]">{t('agent.facts.hint')}</p>
      </div>

      <AnimatedList grouped={false} className="flex flex-col gap-4">
        {groups.map((group) => (
          <div key={group.key} className="flex flex-col gap-1">
            <Tooltip content={group.path}>
              <span className="text-faint w-fit text-[0.6875rem] font-medium tracking-wide">
                {group.label}
              </span>
            </Tooltip>
            <AnimatedList
              as="ul"
              grouped={false}
              className="grid grid-cols-1 gap-x-8 sm:grid-cols-2"
            >
              {group.facts.map((fact) => (
                <FactRow key={fact.id} agentId={agent.id} fact={fact} />
              ))}
            </AnimatedList>
          </div>
        ))}
      </AnimatedList>
    </Card>
  )
}

function FactRow({ agentId, fact }: { agentId: string; fact: ConfigFact }) {
  const { t } = useTranslation()
  const reveal = useRevealConfigFact()
  const browser = useBrowser()
  const [shown, setShown] = useState<string | null>(null)

  const value = fact.masked ? (shown ?? fact.value) : fact.value
  // A masked value is not the real one, so nothing may act on it until it is revealed.
  const actionable = !fact.masked || shown !== null

  return (
    <div className="flex min-w-0 flex-col gap-0.5 py-1.5">
      <span className="text-faint text-[0.6875rem] tracking-wide uppercase">
        {t(`agent.facts.kind.${fact.kind}`)}
      </span>
      <div className="flex min-w-0 items-center gap-1">
        <Tooltip content={`${fact.key} · ${value}`}>
          <code className="text-foreground min-w-0 flex-1 truncate font-mono text-[0.8125rem]">
            {value}
          </code>
        </Tooltip>

        {fact.masked ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={shown ? t('agent.facts.hide') : t('agent.facts.show')}
            loading={reveal.isPending}
            onClick={() => {
              if (shown) {
                setShown(null)
                return
              }
              reveal.mutate(
                { agentId, path: fact.configPath, key: fact.key },
                {
                  onSuccess: (revealed) => setShown(revealed),
                  onError: (error) => toastAppError(error, 'agent.facts.revealFailed'),
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
        ) : null}

        {(fact.kind === 'url' || fact.kind === 'proxy') && actionable ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('agent.facts.open')}
            onClick={() => browser.open(value)}
          >
            <ExternalLink className="size-3.5" />
          </Button>
        ) : null}

        {actionable ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('agent.facts.copy')}
            onClick={() => {
              void copyText(value).then((ok) => {
                if (ok) toast.success(t('toast.copied'), value)
              })
            }}
          >
            <Copy className="size-3.5" />
          </Button>
        ) : null}
      </div>
    </div>
  )
}
