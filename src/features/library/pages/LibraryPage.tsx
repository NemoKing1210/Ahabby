import { Fragment, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Boxes, Plug, RefreshCw, Server, Sparkles, type LucideIcon } from 'lucide-react'

import type { AgentRef } from '@/shared/bindings/AgentRef'
import type { McpServer } from '@/shared/bindings/McpServer'
import type { Skill } from '@/shared/bindings/Skill'
import { formatRelative } from '@/shared/lib/format'
import { AgentIcon } from '@/shared/ui/AgentIcon'
import { AgentTag } from '@/shared/ui/AgentTag'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Button } from '@/shared/ui/Button'
import { CatalogProblems } from '@/shared/ui/CatalogProblems'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { EmptyState, ErrorState } from '@/shared/ui/EmptyState'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SkeletonList } from '@/shared/ui/Primitives'
import { SectionHeader } from '@/shared/ui/SectionHeader'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/Tabs'
import { toast, toastAppError } from '@/shared/ui/Toast'

import { useScanRefresh } from '@/features/agents/api/scan'
import { OtherTab } from '@/features/agents/components/OtherTab'
import { DocumentEditorDialog } from '@/features/editor/components/DocumentEditorDialog'
import { useDeleteMcpServer } from '@/features/mcp/api/hooks'
import { McpCard } from '@/features/mcp/components/McpCard'
import { useDeleteSkill } from '@/features/skills/api/hooks'
import { SkillCard } from '@/features/skills/components/SkillCard'
import { SkillDetailDialog } from '@/features/skills/components/SkillDetailDialog'

import { useLibrary } from '../api/queries'
import { LibraryToolbar } from '../components/LibraryToolbar'
import {
  groupServers,
  groupSkills,
  matchesLibraryQuery,
  ownedBy,
  type LibraryGroup,
  type LibraryGroupMode,
} from '../grouping'

type LibraryTab = 'skills' | 'mcp' | 'other'

/** Anything the frontend asks the backend to remove, addressed the same way. */
interface McpTarget {
  agentId: string
  serverId: string
}

/** Everything the search box can see on a server card, not just its name. */
function transportText(server: McpServer): string {
  const transport = server.transport
  if (transport.type === 'stdio') return [transport.command, ...transport.args].join(' ')
  if (transport.type === 'http') return `${transport.url} ${transport.protocol}`
  return transport.detail
}

/**
 * The grouped body of a tab. Grouping by agent always gets a header, because the header *is*
 * the owner. Grouping by name only heads the names several agents share — the rest fall into
 * one plain list, so a library of mostly one-of-a-kind names does not become a wall of
 * one-card sections.
 */
function LibrarySections<T extends { id: string }>({
  groups,
  mode,
  icon,
  renderItem,
}: {
  groups: LibraryGroup<T>[]
  mode: LibraryGroupMode
  icon: LucideIcon
  renderItem: (item: T) => ReactNode
}) {
  const named =
    mode === 'name'
      ? groups.filter((group) => group.items.length > 1 || group.agents.length > 1)
      : groups
  const singles =
    mode === 'name'
      ? groups
          .filter((group) => group.items.length === 1 && group.agents.length === 1)
          .flatMap((group) => group.items)
      : []

  return (
    <div className="flex flex-col gap-6">
      {named.map((group) => {
        const owner = mode === 'agent' ? group.agents[0] : undefined
        return (
          <section key={group.key} className="flex flex-col gap-3">
            <SectionHeader
              leading={
                owner ? <AgentIcon name={owner.name} icon={owner.icon} size="sm" /> : undefined
              }
              icon={icon}
              title={group.title}
              // A name held by a single entry does not need a count — its owners say it all.
              count={mode === 'agent' || group.items.length > 1 ? group.items.length : undefined}
            >
              {mode === 'name'
                ? group.agents.map((agent) => <AgentTag key={agent.id} agent={agent} />)
                : null}
            </SectionHeader>
            <AnimatedList>
              {group.items.map((item) => (
                <Fragment key={item.id}>{renderItem(item)}</Fragment>
              ))}
            </AnimatedList>
          </section>
        )
      })}
      {singles.length > 0 ? (
        <AnimatedList>
          {singles.map((item) => (
            <Fragment key={item.id}>{renderItem(item)}</Fragment>
          ))}
        </AnimatedList>
      ) : null}
    </div>
  )
}

/**
 * Aggregated view of every installed agent's skills, MCP servers and other resources.
 *
 * The list is filtered in one place (search + owning agent) and then grouped twice over: by
 * name, which gathers the same skill or server across agents under one heading, or by agent,
 * where a shared resource appears under each owner. Nothing here is per-agent hardcoded.
 */
export function LibraryPage() {
  const { t, i18n } = useTranslation()
  const { data, isLoading, error, refetch } = useLibrary()
  const rescan = useScanRefresh()
  const removeSkill = useDeleteSkill()
  const removeServer = useDeleteMcpServer()

  const [query, setQuery] = useState('')
  const [agentFilter, setAgentFilter] = useState('all')
  const [groupMode, setGroupMode] = useState<LibraryGroupMode>('name')
  const [tab, setTab] = useState<LibraryTab>('skills')
  const [detail, setDetail] = useState<Skill | null>(null)
  const [editTarget, setEditTarget] = useState<Skill | null>(null)
  const [deleteSkillTarget, setDeleteSkillTarget] = useState<Skill | null>(null)
  const [deleteServerTarget, setDeleteServerTarget] = useState<McpTarget | null>(null)

  if (isLoading && !data) return <SkeletonList rows={5} />
  if (error && !data) return <ErrorState error={error} onRetry={() => void refetch()} />
  if (!data) return null

  const trimmed = query.trim()
  const needle = trimmed.toLowerCase()

  const skills = data.skills.filter(
    (skill) =>
      ownedBy(skill.agents, agentFilter) &&
      matchesLibraryQuery(needle, [
        skill.name,
        skill.description,
        skill.path,
        ...skill.agents.map((agent) => agent.name),
      ]),
  )
  const servers = data.mcpServers.filter(
    (server) =>
      ownedBy([server.agent], agentFilter) &&
      matchesLibraryQuery(needle, [
        server.name,
        server.sourceConfig,
        server.agent.name,
        server.transport.type,
        transportText(server),
      ]),
  )
  const others = data.other.filter(
    (resource) =>
      ownedBy([resource.agent], agentFilter) &&
      matchesLibraryQuery(needle, [
        resource.label,
        resource.path,
        resource.description,
        resource.agent.name,
      ]),
  )

  // The agent filter lists what the *unfiltered* library holds, with the number of resources
  // each agent contributes, so the options never shift while the user is narrowing the list.
  const agentRefs = new Map<string, AgentRef>()
  const agentCounts = new Map<string, number>()
  const countAgent = (agent: AgentRef) => {
    agentRefs.set(agent.id, agent)
    agentCounts.set(agent.id, (agentCounts.get(agent.id) ?? 0) + 1)
  }
  for (const skill of data.skills) for (const agent of skill.agents) countAgent(agent)
  for (const server of data.mcpServers) countAgent(server.agent)
  for (const resource of data.other) countAgent(resource.agent)
  const agentOptions = [
    { value: 'all', label: t('common.all') },
    ...[...agentRefs.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((agent) => ({
        value: agent.id,
        label: `${agent.name} (${agentCounts.get(agent.id) ?? 0})`,
      })),
  ]

  const dirty = trimmed.length > 0 || agentFilter !== 'all'
  const clear = () => {
    setQuery('')
    setAgentFilter('all')
  }
  const clearAction = dirty ? (
    <Button variant="secondary" size="sm" onClick={clear}>
      {t('library.clearFilters')}
    </Button>
  ) : undefined

  /**
   * What an empty tab says: a search that found nothing, filters that dead-ended, or a
   * category that is genuinely empty on this machine.
   */
  const emptyTab = (title: string, hint: string, icon?: LucideIcon) => {
    if (trimmed.length > 0) {
      return (
        <EmptyState
          title={t('library.noResults', { query: trimmed })}
          action={clearAction}
          icon={icon}
        />
      )
    }
    if (dirty)
      return <EmptyState title={t('library.filteredEmpty')} action={clearAction} icon={icon} />
    return <EmptyState title={title} hint={hint} icon={icon} />
  }

  const renderSkillSections = (groups: LibraryGroup<Skill>[]) => (
    <LibrarySections
      groups={groups}
      mode={groupMode}
      icon={Sparkles}
      renderItem={(skill) => (
        <SkillCard
          skill={skill}
          agents={groupMode === 'name' ? skill.agents : undefined}
          onOpen={setDetail}
          onEdit={setEditTarget}
          onDelete={setDeleteSkillTarget}
        />
      )}
    />
  )

  const renderServerSections = (groups: LibraryGroup<McpServer>[]) => (
    <LibrarySections
      groups={groups}
      mode={groupMode}
      icon={Server}
      renderItem={(server) => (
        <McpCard
          server={server}
          agents={groupMode === 'name' ? [server.agent] : undefined}
          onDelete={(target) =>
            setDeleteServerTarget({ agentId: target.agent.id, serverId: target.id })
          }
        />
      )}
    />
  )

  const serverName = (target: McpTarget | null) =>
    (target ? data.mcpServers.find((server) => server.id === target.serverId) : undefined) ?? null

  const scanned = formatRelative(data.scannedAtMs, i18n.language)
  const editOwner = editTarget?.agents[0]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl">{t('library.title')}</h1>
          <p className="text-muted text-[0.8125rem]">{t('library.subtitle')}</p>
          <p className="text-faint text-[0.75rem]">
            {t('library.agents', { count: data.stats.installedAgents })}
            {scanned ? ` · ${t('library.lastScan', { when: scanned })}` : null}
          </p>
        </div>
        <Button variant="secondary" disabled={rescan.isScanning} onClick={rescan.rescan}>
          <RefreshCw
            className={rescan.isScanning ? 'size-3.5 animate-spin' : 'size-3.5'}
            aria-hidden
          />
          {rescan.isScanning ? t('library.rescanning') : t('library.rescan')}
        </Button>
      </PageHeader>

      <CatalogProblems problems={data.problems} />

      <LibraryToolbar
        query={query}
        onQueryChange={setQuery}
        agent={agentFilter}
        onAgentChange={setAgentFilter}
        agentOptions={agentOptions}
        groupMode={groupMode}
        onGroupModeChange={setGroupMode}
        showGrouping={tab !== 'other'}
        dirty={dirty}
        onClear={clear}
      />

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as LibraryTab)}
        className="flex flex-col"
      >
        <TabsList>
          <TabsTrigger value="skills">
            {t('library.tabs.skills')}
            {skills.length > 0 ? <span className="text-faint ml-1.5">{skills.length}</span> : null}
          </TabsTrigger>
          <TabsTrigger value="mcp">
            {t('library.tabs.mcp')}
            {servers.length > 0 ? (
              <span className="text-faint ml-1.5">{servers.length}</span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="other">
            {t('library.tabs.other')}
            {others.length > 0 ? <span className="text-faint ml-1.5">{others.length}</span> : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="skills">
          {skills.length === 0
            ? emptyTab(t('library.empty'), t('library.emptyHint'), Sparkles)
            : renderSkillSections(groupSkills(skills, groupMode))}
        </TabsContent>

        <TabsContent value="mcp">
          {servers.length === 0
            ? emptyTab(t('mcp.none'), t('mcp.noneHint'), Plug)
            : renderServerSections(groupServers(servers, groupMode))}
        </TabsContent>

        <TabsContent value="other">
          {others.length === 0 ? (
            emptyTab(t('library.empty'), t('library.emptyHint'), Boxes)
          ) : (
            <OtherTab resources={others} showAgent />
          )}
        </TabsContent>
      </Tabs>

      <SkillDetailDialog
        skill={detail}
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) setDetail(null)
        }}
        onEdit={(skill) => {
          setDetail(null)
          setEditTarget(skill)
        }}
        onDelete={(skill) => {
          setDetail(null)
          setDeleteSkillTarget(skill)
        }}
      />

      {editTarget?.entryPath && editOwner ? (
        <DocumentEditorDialog
          key={editTarget.entryPath}
          agentId={editOwner.id}
          document={{
            path: editTarget.entryPath,
            label: editTarget.name,
            format: 'markdown',
            editable: editTarget.removable,
            description: editTarget.description,
          }}
          onOpenChange={() => setEditTarget(null)}
        />
      ) : null}

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
              onError: (deleteError) => {
                toastAppError(deleteError)
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
            onError: (deleteError) => {
              toastAppError(deleteError)
              setDeleteServerTarget(null)
            },
          })
        }}
      />
    </div>
  )
}
