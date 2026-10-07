import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Boxes, Plug, Plus, RefreshCw, Server, Sparkles, type LucideIcon } from 'lucide-react'

import type { AgentRef } from '@/shared/bindings/AgentRef'
import type { McpServer } from '@/shared/bindings/McpServer'
import type { Skill } from '@/shared/bindings/Skill'
import { matchesActivity, type ActivityFilter } from '@/shared/lib/activity'
import { formatRelative } from '@/shared/lib/format'
import { isSharedOwner, ownerName, SHARED_OWNER } from '@/shared/lib/owners'
import { useSessionState } from '@/shared/lib/sessionState'
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
import { anyAgentOption, ownerOption } from '@/shared/ui/agentOptions'

import { useScanRefresh } from '@/features/agents/api/scan'
import { useAgents } from '@/features/agents/api/queries'
import { OTHER_KIND_ORDER, OtherTab } from '@/features/agents/components/OtherTab'
import { DocumentEditorDialog } from '@/features/editor/components/DocumentEditorDialog'
import { useDeleteMcpServer, useSetMcpServerEnabled } from '@/features/mcp/api/hooks'
import { CreateMcpServerDialog } from '@/features/mcp/components/CreateMcpServerDialog'
import { McpCard } from '@/features/mcp/components/McpCard'
import { useDeleteSkill, useSetSkillEnabled } from '@/features/skills/api/hooks'
import { CreateSkillDialog } from '@/features/skills/components/CreateSkillDialog'
import { SkillCard } from '@/features/skills/components/SkillCard'
import { SkillDetailDialog } from '@/features/skills/components/SkillDetailDialog'

import { useLibrary } from '../api/queries'
import { LibraryToolbar } from '../components/LibraryToolbar'
import {
  groupServers,
  groupSkills,
  matchesLibraryQuery,
  originMatches,
  ownedBy,
  type LibraryGroup,
  type LibraryGroupMode,
  type LibraryOrigin,
} from '../grouping'
import {
  resourceFields,
  serverFields,
  skillFields,
  sortGroups,
  sortItems,
  type LibrarySort,
} from '../sorting'

type LibraryTab = 'skills' | 'mcp' | 'other'

/** Transport kinds the MCP facet offers, in display order. */
const MCP_TRANSPORTS = ['stdio', 'http', 'unknown'] as const

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
  const { t } = useTranslation()
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
        const shared = owner !== undefined && isSharedOwner(owner.id)
        return (
          <section key={group.key} className="flex flex-col gap-3">
            <SectionHeader
              leading={
                owner ? (
                  <AgentIcon name={owner.name} icon={owner.icon} ownerId={owner.id} size="sm" />
                ) : undefined
              }
              icon={icon}
              // The agent-neutral surface is not an agent: its header is named in the UI's
              // language, while a real agent keeps the manifest's name.
              title={shared ? t('library.shared') : group.title}
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
 * Aggregated view of every installed agent's skills, MCP servers and other resources, plus
 * the agent-neutral ("shared") ones from `~/.agents` that belong to no single agent.
 *
 * The list is filtered in one place (search + owning agent) and then grouped twice over: by
 * name, which gathers the same skill or server across agents under one heading, or by agent,
 * where a shared resource appears under each owner — the shared surface under its own,
 * translated heading. Nothing here is per-agent hardcoded.
 */
export function LibraryPage() {
  const { t, i18n } = useTranslation()
  const { data, isLoading, error, refetch } = useLibrary()
  const agents = useAgents()
  const rescan = useScanRefresh()
  const removeSkill = useDeleteSkill()
  const removeServer = useDeleteMcpServer()
  const setSkillEnabled = useSetSkillEnabled()
  const setServerEnabled = useSetMcpServerEnabled()

  // Every filter, the sort and the tab are kept for the session (`useSessionState`): the library is
  // read, walked into one resource and left, and coming back should not cost the refinement.
  const [query, setQuery] = useSessionState('library.query', '')
  const [agentFilter, setAgentFilter] = useSessionState('library.owner', 'all')
  const [origin, setOrigin] = useSessionState<LibraryOrigin>('library.origin', 'all')
  const [sort, setSort] = useSessionState<LibrarySort>('library.sort', 'name')
  const [facet, setFacet] = useSessionState('library.facet', 'all')
  const [activity, setActivity] = useSessionState<ActivityFilter>('library.activity', 'all')
  const [groupMode, setGroupMode] = useSessionState<LibraryGroupMode>('library.group', 'name')
  const [tab, setTab] = useSessionState<LibraryTab>('library.tab', 'skills')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [editTarget, setEditTarget] = useState<Skill | null>(null)
  const [deleteSkillTarget, setDeleteSkillTarget] = useState<Skill | null>(null)
  const [deleteServerTarget, setDeleteServerTarget] = useState<McpTarget | null>(null)
  // Which creation form is open; the owner is chosen inside it.
  const [createTarget, setCreateTarget] = useState<LibraryTab | null>(null)

  // Owners a new skill or server can belong to: the agent-neutral shared surface first (the
  // general case, and the default), then every installed agent. A resource written for an
  // agent that is not installed would not be scanned, so those are left out.
  const owners = useMemo<AgentRef[]>(
    () => [
      SHARED_OWNER,
      ...(agents.data?.agents ?? [])
        .filter((agent) => agent.status === 'installed')
        .map((agent) => ({ id: agent.id, name: agent.name, icon: agent.icon })),
    ],
    [agents.data],
  )

  const toggleSkill = (skill: Skill, enabled: boolean) => {
    const owner = skill.agents[0]
    if (!owner) return
    setSkillEnabled.mutate(
      { agentId: owner.id, skillId: skill.id, enabled },
      {
        onSuccess: (result) => {
          toast.success(
            t(enabled ? 'skills.toggledOn' : 'skills.toggledOff', { name: result.data.name }),
          )
        },
        onError: (error) => toastAppError(error),
      },
    )
  }
  const toggleServer = (server: McpServer, enabled: boolean) => {
    setServerEnabled.mutate(
      { agentId: server.agent.id, serverId: server.id, enabled },
      {
        onSuccess: (result) => {
          toast.success(t(enabled ? 'mcp.toggledOn' : 'mcp.toggledOff', { name: result.data.name }))
        },
        onError: (error) => toastAppError(error),
      },
    )
  }

  // Every tab has its own facets and its own activity filter, so a refinement never survives a
  // switch to another tab. The tab itself is remembered with the rest, which keeps the two in
  // step: a revisit returns to the tab its facet belongs to.
  const switchTab = (value: string) => {
    setTab(value as LibraryTab)
    setFacet('all')
    setActivity('all')
  }

  if (isLoading && !data) return <SkeletonList rows={5} />
  if (error && !data) return <ErrorState error={error} onRetry={() => void refetch()} />
  if (!data) return null

  // The dialog carries a switch, so it reads the live skill out of the library the mutation
  // refreshes instead of holding a snapshot that would show a stale state.
  const detail = data.skills.find((skill) => skill.id === detailId) ?? null

  const trimmed = query.trim()
  const needle = trimmed.toLowerCase()
  const sharedLabel = t('library.shared')

  // Everything except the tab's own facet: the facet chips show how many items each choice
  // would leave, so the counts must not depend on the current facet.
  const skillBase = data.skills.filter(
    (skill) =>
      ownedBy(skill.agents, agentFilter) &&
      originMatches(skill.agents, origin) &&
      matchesLibraryQuery(needle, [
        skill.name,
        skill.description,
        skill.path,
        ...skill.agents.map((agent) => ownerName(agent, sharedLabel)),
      ]),
  )
  const serverBase = data.mcpServers.filter(
    (server) =>
      ownedBy([server.agent], agentFilter) &&
      originMatches([server.agent], origin) &&
      matchesLibraryQuery(needle, [
        server.name,
        server.sourceConfig,
        ownerName(server.agent, sharedLabel),
        server.transport.type,
        transportText(server),
      ]),
  )
  const otherBase = data.other.filter(
    (resource) =>
      ownedBy([resource.agent], agentFilter) &&
      originMatches([resource.agent], origin) &&
      matchesLibraryQuery(needle, [
        resource.label,
        resource.path,
        resource.description,
        ownerName(resource.agent, sharedLabel),
      ]),
  )

  const skills = skillBase.filter(
    (skill) =>
      matchesActivity(skill.enabled, activity) &&
      (facet === 'all' || (facet === 'unverified' && skill.unverified)),
  )
  const servers = serverBase.filter(
    (server) =>
      matchesActivity(server.enabled, activity) &&
      (facet === 'all' || server.transport.type === facet),
  )
  const others = sortItems(
    otherBase.filter((resource) => facet === 'all' || resource.kind === facet),
    sort,
    resourceFields,
  )

  // A tab badge is what that tab shows the moment it is opened. Switching tabs resets the facet
  // and the activity filter, so the inactive tab's badge must not follow the active tab's
  // refinement — otherwise narrowing one list looks like it emptied another.
  const skillBadge = tab === 'skills' ? skills.length : skillBase.length
  const serverBadge = tab === 'mcp' ? servers.length : serverBase.length
  const otherBadge = tab === 'other' ? others.length : otherBase.length

  /**
   * Facet chips for the active tab. A choice with nothing behind it is noise, but the
   * *selected* one always stays — otherwise narrowing the search could hide the very filter
   * that made the list empty.
   */
  const visibleFacets = <T extends { value: string; count?: number }>(options: T[]): T[] =>
    options.filter(
      (option) => option.value === 'all' || option.value === facet || (option.count ?? 0) > 0,
    )

  const skillFacets = visibleFacets([
    { value: 'all', label: t('common.all'), count: skillBase.length },
    {
      value: 'unverified',
      label: t('library.facetUnverified'),
      count: skillBase.filter((skill) => skill.unverified).length,
    },
  ])
  const serverFacets = visibleFacets([
    { value: 'all', label: t('common.all'), count: serverBase.length },
    ...MCP_TRANSPORTS.map((type) => ({
      value: type,
      label: type === 'unknown' ? t('common.unknown') : type,
      count: serverBase.filter((server) => server.transport.type === type).length,
    })),
  ])
  const otherFacets = visibleFacets([
    { value: 'all', label: t('common.all'), count: otherBase.length },
    ...OTHER_KIND_ORDER.map((kind) => ({
      value: kind,
      label: t(`library.kind.${kind}`),
      count: otherBase.filter((resource) => resource.kind === kind).length,
    })),
  ])

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
    anyAgentOption(
      t('common.all'),
      String(data.skills.length + data.mcpServers.length + data.other.length),
    ),
    ...[...agentRefs.values()]
      .sort((a, b) => ownerName(a, sharedLabel).localeCompare(ownerName(b, sharedLabel)))
      .map((agent) => ownerOption(agent, sharedLabel, String(agentCounts.get(agent.id) ?? 0))),
  ]

  const dirty =
    trimmed.length > 0 ||
    agentFilter !== 'all' ||
    origin !== 'all' ||
    facet !== 'all' ||
    activity !== 'all'
  const clear = () => {
    setQuery('')
    setAgentFilter('all')
    setOrigin('all')
    setFacet('all')
    setActivity('all')
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
  const emptyTab = (title: string, hint: string, icon?: LucideIcon, action?: ReactNode) => {
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
    return <EmptyState title={title} hint={hint} icon={icon} action={action} />
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
          onOpen={(skill) => setDetailId(skill.id)}
          onEdit={setEditTarget}
          onDelete={setDeleteSkillTarget}
          onToggle={toggleSkill}
          toggleBusy={setSkillEnabled.isPending && setSkillEnabled.variables?.skillId === skill.id}
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
          onToggle={toggleServer}
          toggleBusy={
            setServerEnabled.isPending && setServerEnabled.variables?.serverId === server.id
          }
        />
      )}
    />
  )

  const serverName = (target: McpTarget | null) =>
    (target ? data.mcpServers.find((server) => server.id === target.serverId) : undefined) ?? null

  const scanned = formatRelative(data.scannedAtMs, i18n.language)
  const editOwner = editTarget?.agents[0]

  // The button above the list follows the active tab: the library has one creation form per
  // resource kind, and "Other" documents are not creatable.
  const createAction = (target: 'skills' | 'mcp') => (
    <Button variant="secondary" size="sm" onClick={() => setCreateTarget(target)}>
      <Plus className="size-3.5" aria-hidden />
      {target === 'skills' ? t('skills.create') : t('mcp.create')}
    </Button>
  )

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
        <Button variant="secondary" onClick={rescan.rescan} loading={rescan.isScanning}>
          {rescan.isScanning ? null : <RefreshCw className="size-3.5" aria-hidden />}
          {t('library.rescan')}
        </Button>
      </PageHeader>

      <CatalogProblems problems={data.problems} />

      <LibraryToolbar
        query={query}
        onQueryChange={setQuery}
        owner={agentFilter}
        onOwnerChange={setAgentFilter}
        ownerOptions={agentOptions}
        origin={origin}
        onOriginChange={setOrigin}
        originOptions={[
          { value: 'all', label: t('library.sourceAll') },
          { value: 'shared', label: t('library.sourceShared') },
          { value: 'agents', label: t('library.sourceAgents') },
        ]}
        sort={sort}
        onSortChange={setSort}
        facet={{
          value: facet,
          onChange: setFacet,
          options: tab === 'skills' ? skillFacets : tab === 'mcp' ? serverFacets : otherFacets,
        }}
        activity={
          tab === 'other'
            ? null
            : {
                items: tab === 'skills' ? skillBase : serverBase,
                value: activity,
                onChange: setActivity,
              }
        }
        groupMode={groupMode}
        onGroupModeChange={setGroupMode}
        showGrouping={tab !== 'other'}
        dirty={dirty}
        onClear={clear}
      />

      <Tabs value={tab} onValueChange={switchTab} className="flex flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="skills">
              {t('library.tabs.skills')}
              {skillBadge > 0 ? <span className="text-faint ml-1.5">{skillBadge}</span> : null}
            </TabsTrigger>
            <TabsTrigger value="mcp">
              {t('library.tabs.mcp')}
              {serverBadge > 0 ? <span className="text-faint ml-1.5">{serverBadge}</span> : null}
            </TabsTrigger>
            <TabsTrigger value="other">
              {t('library.tabs.other')}
              {otherBadge > 0 ? <span className="text-faint ml-1.5">{otherBadge}</span> : null}
            </TabsTrigger>
          </TabsList>
          {tab === 'other' ? null : createAction(tab)}
        </div>

        <TabsContent value="skills">
          {skills.length === 0
            ? emptyTab(
                t('library.empty'),
                t('library.emptyHintCreate'),
                Sparkles,
                createAction('skills'),
              )
            : renderSkillSections(sortGroups(groupSkills(skills, groupMode), sort, skillFields))}
        </TabsContent>

        <TabsContent value="mcp">
          {servers.length === 0
            ? emptyTab(t('mcp.none'), t('mcp.noneHintCreate'), Plug, createAction('mcp'))
            : renderServerSections(
                sortGroups(groupServers(servers, groupMode), sort, serverFields),
              )}
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
          if (!open) setDetailId(null)
        }}
        onEdit={(skill) => {
          setDetailId(null)
          setEditTarget(skill)
        }}
        onDelete={(skill) => {
          setDetailId(null)
          setDeleteSkillTarget(skill)
        }}
        onToggle={toggleSkill}
        toggleBusy={setSkillEnabled.isPending && setSkillEnabled.variables?.skillId === detail?.id}
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

      {createTarget === 'skills' ? (
        <CreateSkillDialog owners={owners} onClose={() => setCreateTarget(null)} />
      ) : null}

      {createTarget === 'mcp' ? (
        <CreateMcpServerDialog owners={owners} onClose={() => setCreateTarget(null)} />
      ) : null}
    </div>
  )
}
