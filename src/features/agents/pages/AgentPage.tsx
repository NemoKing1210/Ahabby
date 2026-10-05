import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Play, RefreshCw, Trash2 } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import type { InstallAction } from '@/shared/bindings/InstallAction'
import { AgentIcon } from '@/shared/ui/AgentIcon'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { ErrorState, EmptyState } from '@/shared/ui/EmptyState'
import { SkeletonList } from '@/shared/ui/Primitives'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/Tabs'

import { InstallDialog } from '@/features/install/components/InstallDialog'
import { ConfigsTab } from '@/features/configs/components/ConfigsTab'
import { McpTab } from '@/features/mcp/components/McpTab'
import { SkillsTab } from '@/features/skills/components/SkillsTab'

import { useAgent } from '../api/queries'
import { OtherTab } from '../components/OtherTab'
import { OverviewTab } from '../components/OverviewTab'
import { RemoveAgentDialog } from '../components/RemoveAgentDialog'

export function AgentPage() {
  const { agentId } = useParams<{ agentId: string }>()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { agent, isLoading, error, isMissing } = useAgent(agentId)
  const [installAction, setInstallAction] = useState<InstallAction | null>(null)
  const [removeOpen, setRemoveOpen] = useState(false)

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <SkeletonList rows={3} />
      </div>
    )
  }

  if (error) return <ErrorState error={error} />

  if (isMissing || !agent) {
    return (
      <EmptyState
        title={t('agent.notFound')}
        action={
          <Button variant="secondary" asChild>
            <Link to="/">{t('agent.backToList')}</Link>
          </Button>
        }
      />
    )
  }

  const installed = agent.status === 'installed'

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Link
          to="/"
          className="text-muted hover:text-foreground flex w-fit items-center gap-1.5 text-[12px]"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          {t('agent.backToList')}
        </Link>

        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <AgentIcon name={agent.name} icon={agent.icon} size="lg" />
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl">{agent.name}</h1>
                {installed && agent.version ? (
                  <Badge tone="neutral">{agent.version.raw}</Badge>
                ) : (
                  <Badge tone="outline">{t('agents.notInstalled')}</Badge>
                )}
                {agent.update ? (
                  <Badge tone="accent">
                    {t('agents.updateTo', { version: agent.update.latest })}
                  </Badge>
                ) : null}
                {agent.unverified.length > 0 ? (
                  <Badge tone="warning">{t('agents.unverified')}</Badge>
                ) : null}
              </div>
              <p className="text-muted max-w-prose text-[13px]">
                {agent.tagline ?? agent.description}
              </p>
              {!installed ? (
                <p className="text-faint text-[12px]">{t('agent.notInstalledHint')}</p>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {installed ? (
              agent.canUpdate ? (
                <Button variant="secondary" onClick={() => setInstallAction('update')}>
                  <RefreshCw className="size-3.5" aria-hidden />
                  {t('agents.update')}
                </Button>
              ) : null
            ) : agent.canInstall ? (
              <Button variant="primary" onClick={() => setInstallAction('install')}>
                <Play className="size-3.5" aria-hidden />
                {t('agents.install')}
              </Button>
            ) : null}

            <Button variant="ghost" onClick={() => setRemoveOpen(true)}>
              <Trash2 className="size-3.5" aria-hidden />
              {t('agents.remove')}
            </Button>
          </div>
        </header>
      </div>

      <Tabs defaultValue="overview" className="flex flex-col">
        <TabsList>
          <TabsTrigger value="overview">{t('agent.tabs.overview')}</TabsTrigger>
          <TabsTrigger value="configs">
            {t('agent.tabs.configs')}
            {agent.configs.length > 0 ? (
              <span className="text-faint ml-1.5">{agent.configs.length}</span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="skills">
            {t('agent.tabs.skills')}
            {agent.skills.length > 0 ? (
              <span className="text-faint ml-1.5">{agent.skills.length}</span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="mcp">
            {t('agent.tabs.mcp')}
            {agent.mcpServers.length > 0 ? (
              <span className="text-faint ml-1.5">{agent.mcpServers.length}</span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="other">
            {t('agent.tabs.other')}
            {agent.other.length > 0 ? (
              <span className="text-faint ml-1.5">{agent.other.length}</span>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab agent={agent} onInstall={(_, action) => setInstallAction(action)} />
        </TabsContent>
        <TabsContent value="configs">
          <ConfigsTab agentId={agent.id} configs={agent.configs} />
        </TabsContent>
        <TabsContent value="skills">
          <SkillsTab agentId={agent.id} skills={agent.skills} />
        </TabsContent>
        <TabsContent value="mcp">
          <McpTab agentId={agent.id} servers={agent.mcpServers} />
        </TabsContent>
        <TabsContent value="other">
          <OtherTab resources={agent.other} />
        </TabsContent>
      </Tabs>

      {installAction !== null ? (
        <InstallDialog
          key={`${agent.id}-${installAction}`}
          agent={agent}
          action={installAction}
          onOpenChange={() => setInstallAction(null)}
        />
      ) : null}

      {removeOpen ? (
        <RemoveAgentDialog
          agent={agent}
          onRemoved={() => navigate('/')}
          onClose={() => setRemoveOpen(false)}
        />
      ) : null}
    </div>
  )
}
