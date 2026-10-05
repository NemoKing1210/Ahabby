import { EyeOff, Undo2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AgentIcon } from '@/shared/ui/AgentIcon'
import { Button } from '@/shared/ui/Button'
import { toast, toastAppError } from '@/shared/ui/Toast'

import { useRestoreAgent } from '@/features/agents/api/queries'

import { SettingsPageHeading, SettingsSection } from '../components/SettingsSection'
import { useSettings } from '../api/hooks'

export function SettingsHiddenPage() {
  const { t } = useTranslation()
  const { data: settings } = useSettings()
  const restore = useRestoreAgent()
  const hidden = settings?.hiddenAgents ?? []

  return (
    <div className="flex flex-col gap-5">
      <SettingsPageHeading
        icon={EyeOff}
        title={t('settings.hiddenAgents')}
        hint={t('settings.hiddenAgentsHint')}
      />

      <SettingsSection>
        {hidden.length === 0 ? (
          <p className="text-muted py-3 text-[0.8125rem]">{t('settings.hiddenAgentsNone')}</p>
        ) : (
          <ul className="flex flex-col gap-2 py-3">
            {hidden.map((agent) => (
              <li key={agent.id} className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <AgentIcon name={agent.name} icon={agent.icon} size="sm" />
                  <span className="truncate text-sm">{agent.name}</span>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={restore.isPending}
                  onClick={() =>
                    restore.mutate(agent.id, {
                      onSuccess: () =>
                        toast.success(t('settings.agentRestored', { name: agent.name })),
                      onError: (error) => toastAppError(error),
                    })
                  }
                >
                  <Undo2 className="size-3.5" aria-hidden />
                  {t('settings.restoreAgent')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>
    </div>
  )
}
