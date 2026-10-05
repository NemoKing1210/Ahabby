import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, Sparkles } from 'lucide-react'

import type { AgentRef } from '@/shared/bindings/AgentRef'
import type { Skill } from '@/shared/bindings/Skill'
import { groupBy, shortenPath } from '@/shared/lib/format'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { EmptyState, ErrorState } from '@/shared/ui/EmptyState'
import { Input } from '@/shared/ui/Input'
import { SkeletonList } from '@/shared/ui/Primitives'
import { Select } from '@/shared/ui/Select'
import { toast, toastAppError } from '@/shared/ui/Toast'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/Tabs'

import { OtherTab } from '@/features/agents/components/OtherTab'
import { useDeleteMcpServer } from '@/features/mcp/api/hooks'
import { McpCard } from '@/features/mcp/components/McpCard'
import { useDeleteSkill } from '@/features/skills/api/hooks'
import { SkillDetailDialog } from '@/features/skills/components/SkillDetailDialog'

import { useLibrary } from '../api/queries'

type GroupMode = 'name' | 'agent'

/** Anything the frontend asks the backend to remove, addressed the same way. */
interface McpTarget {
  agentId: string
  serverId: string
}

function filterItems<T>(
  items: T[],
  needle: string,
  agentFilter: string,
  agentsOf: (item: T) => AgentRef[],
  text: (item: T) => string,
): T[] {
  return items.filter((item) => {
    const byAgent =
      agentFilter === 'all' || agentsOf(item).some((agent) => agent.id === agentFilter)
    const byText = needle.length === 0 || text(item).toLowerCase().includes(needle)
    return byAgent && byText
  })
}

function SkillList({
  skills,
  onOpen,
  onDelete,
}: {
  skills: Skill[]
  onOpen: (skill: Skill) => void
  onDelete: (skill: Skill) => void
}) {
  const { t } = useTranslation()
  return (
    <AnimatedList className="flex flex-col gap-3">
      {skills.map((skill) => (
        <Card key={skill.id} className="flex items-start gap-3 p-4">
          <Sparkles className="text-faint mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="text-foreground hover:text-accent-strong text-sm"
                onClick={() => onOpen(skill)}
              >
                {skill.name}
              </button>
              {skill.agents.map((agent) => (
                <Badge key={agent.id} tone="outline">
                  {agent.name}
                </Badge>
              ))}
              {!skill.removable ? <Badge tone="neutral">{t('skills.pluginManaged')}</Badge> : null}
            </div>
            {skill.description ? (
              <p className="text-muted max-w-prose text-[12px]">{skill.description}</p>
            ) : null}
            <code className="text-faint font-mono text-[11px]">{shortenPath(skill.path, 4)}</code>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => onOpen(skill)}>
              {t('common.open')}
            </Button>
            {skill.removable ? (
              <Button variant="ghost" size="sm" onClick={() => onDelete(skill)}>
                {t('skills.delete')}
              </Button>
            ) : null}
          </div>
        </Card>
      ))}
    </AnimatedList>
  )
}

/** Aggregated view of every installed agent's skills, MCP servers and other resources. */
export function LibraryPage() {
  const { t } = useTranslation()
  const { data, isLoading, error, refetch } = useLibrary()
  const removeSkill = useDeleteSkill()
  const removeServer = useDeleteMcpServer()

  const [query, setQuery] = useState('')
  const [agentFilter, setAgentFilter] = useState('all')
  const [groupMode, setGroupMode] = useState<GroupMode>('name')
  const [detail, setDetail] = useState<Skill | null>(null)
  const [deleteSkillTarget, setDeleteSkillTarget] = useState<Skill | null>(null)
  const [deleteServerTarget, setDeleteServerTarget] = useState<McpTarget | null>(null)

  if (isLoading && !data) return <SkeletonList rows={5} />
  if (error && !data) return <ErrorState error={error} onRetry={() => void refetch()} />
  if (!data) return null

  const needle = query.trim().toLowerCase()
  const skills = filterItems(
    data.skills,
    needle,
    agentFilter,
    (skill) => skill.agents,
    (skill) => `${skill.name} ${skill.description ?? ''} ${skill.path}`,
  )
  const servers = filterItems(
    data.mcpServers,
    needle,
    agentFilter,
    (server) => [server.agent],
    (server) => `${server.name} ${server.transport.type} ${server.sourceConfig}`,
  )
  const others = filterItems(
    data.other,
    needle,
    agentFilter,
    (resource) => [resource.agent],
    (resource) => `${resource.label} ${resource.path}`,
  )

  const agentIndex = new Map<string, AgentRef>()
  for (const item of [
    ...data.skills.flatMap((skill) => skill.agents),
    ...data.mcpServers.map((server) => server.agent),
    ...data.other.map((resource) => resource.agent),
  ]) {
    if (!agentIndex.has(item.id)) agentIndex.set(item.id, item)
  }
  const agentOptions = [
    { value: 'all', label: t('common.all') },
    ...[...agentIndex.values()].map((agent) => ({ value: agent.id, label: agent.name })),
  ]

  const groupedSkills = groupBy(skills, (skill) =>
    groupMode === 'name' ? skill.name.toLowerCase() : (skill.agents[0]?.name ?? ''),
  )
  const groupedServers = groupBy(servers, (server) =>
    groupMode === 'name' ? server.name.toLowerCase() : server.agent.name,
  )

  const serverName = (target: McpTarget | null) =>
    (target ? data.mcpServers.find((server) => server.id === target.serverId) : undefined) ?? null

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl">{t('library.title')}</h1>
        <p className="text-muted text-[13px]">{t('library.subtitle')}</p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="w-72"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('library.searchPlaceholder')}
          aria-label={t('common.search')}
          leading={<Search className="size-3.5" />}
        />
        <Select
          ariaLabel={t('library.filterAgent')}
          value={agentFilter}
          onValueChange={setAgentFilter}
          options={agentOptions}
          className="min-w-40"
        />
        <Select
          ariaLabel={t('library.groupBy')}
          value={groupMode}
          onValueChange={(value) => setGroupMode(value === 'agent' ? 'agent' : 'name')}
          options={[
            { value: 'name', label: t('library.groupByName') },
            { value: 'agent', label: t('library.groupByAgent') },
          ]}
          className="min-w-40"
        />
        <div className="ml-auto flex items-center gap-2">
          <Badge tone="neutral">
            {t('library.tabs.skills')}: {data.stats.skills}
          </Badge>
          <Badge tone="neutral">
            {t('library.tabs.mcp')}: {data.stats.mcpServers}
          </Badge>
          <Badge tone="neutral">
            {t('library.tabs.other')}: {data.stats.other}
          </Badge>
        </div>
      </div>

      <Tabs defaultValue="skills" className="flex flex-col">
        <TabsList>
          <TabsTrigger value="skills">{t('library.tabs.skills')}</TabsTrigger>
          <TabsTrigger value="mcp">{t('library.tabs.mcp')}</TabsTrigger>
          <TabsTrigger value="other">{t('library.tabs.other')}</TabsTrigger>
        </TabsList>

        <TabsContent value="skills">
          {skills.length === 0 ? (
            <EmptyState
              title={query.length > 0 ? t('library.noResults', { query }) : t('library.empty')}
              hint={query.length > 0 ? undefined : t('library.emptyHint')}
              icon={Sparkles}
            />
          ) : (
            <div className="flex flex-col gap-6">
              {Array.from(groupedSkills.entries()).map(([group, items]) => (
                <section key={group} className="flex flex-col gap-2">
                  {items.length > 1 && groupMode === 'name' ? (
                    <h3 className="text-muted flex items-center gap-2 text-[13px]">
                      {items[0]?.name}
                      <Badge tone="neutral">{items.length}</Badge>
                    </h3>
                  ) : null}
                  {groupMode === 'agent' ? (
                    <h3 className="text-muted text-[13px]">{items[0]?.agents[0]?.name}</h3>
                  ) : null}
                  <SkillList skills={items} onOpen={setDetail} onDelete={setDeleteSkillTarget} />
                </section>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="mcp">
          {servers.length === 0 ? (
            <EmptyState
              title={query.length > 0 ? t('library.noResults', { query }) : t('mcp.none')}
              hint={query.length > 0 ? undefined : t('mcp.noneHint')}
            />
          ) : (
            <div className="flex flex-col gap-6">
              {Array.from(groupedServers.entries()).map(([group, items]) => (
                <section key={group} className="flex flex-col gap-2">
                  <h3 className="text-muted flex flex-wrap items-center gap-2 text-[13px]">
                    {items[0]?.name}
                    <Badge tone="neutral">{items.length}</Badge>
                  </h3>
                  <AnimatedList className="flex flex-col gap-3">
                    {items.map((server) => (
                      <McpCard
                        key={server.id}
                        server={server}
                        agents={items.map((item) => item.agent)}
                        onDelete={(target) =>
                          setDeleteServerTarget({ agentId: target.agent.id, serverId: target.id })
                        }
                      />
                    ))}
                  </AnimatedList>
                </section>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="other">
          <OtherTab resources={others} />
        </TabsContent>
      </Tabs>

      <SkillDetailDialog
        skill={detail}
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) setDetail(null)
        }}
        onDelete={(skill) => {
          setDetail(null)
          setDeleteSkillTarget(skill)
        }}
      />

      <ConfirmDialog
        open={deleteSkillTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteSkillTarget(null)
        }}
        title={t('skills.deleteTitle', { name: deleteSkillTarget?.name ?? '' })}
        description={t('skills.deleteBody', { path: deleteSkillTarget?.path ?? '' })}
        confirmLabel={t('skills.delete')}
        busy={removeSkill.isPending}
        onConfirm={() => {
          const target = deleteSkillTarget
          const owner = target?.agents[0]
          if (!target || !owner) return
          removeSkill.mutate(
            { agentId: owner.id, skillId: target.id },
            {
              onSuccess: () => {
                toast.success(t('skills.deleted', { name: target.name }))
                setDeleteSkillTarget(null)
              },
              onError: (error) => {
                toastAppError(error)
                setDeleteSkillTarget(null)
              },
            },
          )
        }}
      />

      <ConfirmDialog
        open={deleteServerTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteServerTarget(null)
        }}
        title={t('mcp.deleteTitle', { name: serverName(deleteServerTarget)?.name ?? '' })}
        description={t('mcp.deleteBody', {
          config: serverName(deleteServerTarget)?.sourceConfig ?? '',
        })}
        confirmLabel={t('mcp.delete')}
        busy={removeServer.isPending}
        onConfirm={() => {
          if (!deleteServerTarget) return
          const target = deleteServerTarget
          const name = serverName(target)?.name ?? target.serverId
          removeServer.mutate(target, {
            onSuccess: () => {
              toast.success(t('mcp.deleted', { name }))
              setDeleteServerTarget(null)
            },
            onError: (error) => {
              toastAppError(error)
              setDeleteServerTarget(null)
            },
          })
        }}
      />
    </div>
  )
}
