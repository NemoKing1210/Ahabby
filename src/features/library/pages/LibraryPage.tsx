import { Fragment, useCallback, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Boxes, Plug, Plus, RefreshCw, Server, Sparkles, type LucideIcon } from 'lucide-react'

import type { AgentRef } from '@/shared/bindings/AgentRef'
import type { McpServer } from '@/shared/bindings/McpServer'
import type { OtherResource } from '@/shared/bindings/OtherResource'
import type { Skill } from '@/shared/bindings/Skill'
import { matchesActivity, type ActivityFilter } from '@/shared/lib/activity'
import { formatRelative } from '@/shared/lib/format'
import { useLazyRows } from '@/shared/lib/lazyRows'
import { isSharedOwner, ownerName, SHARED_OWNER } from '@/shared/lib/owners'
import { useSessionState } from '@/shared/lib/sessionState'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Button } from '@/shared/ui/Button'
import { CatalogProblems } from '@/shared/ui/CatalogProblems'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { EmptyState, ErrorState } from '@/shared/ui/EmptyState'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SkeletonList } from '@/shared/ui/Primitives'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/Tabs'
import { toast, toastAppError } from '@/shared/ui/Toast'
import { anyAgentOption, ownerOption } from '@/shared/ui/agentOptions'

import { useScanRefresh } from '@/features/agents/api/scan'
import { useAgents, useFavoriteAgents } from '@/features/agents/api/queries'
import { OTHER_KIND_ORDER, OtherTab } from '@/features/agents/components/OtherTab'
import { orderByFavorite } from '@/features/agents/lib/favorites'
import { DocumentEditorDialog } from '@/features/editor/components/DocumentEditorDialog'
import { useDeleteMcpServer, useSetMcpServerEnabled } from '@/features/mcp/api/hooks'
import { CreateMcpServerDialog } from '@/features/mcp/components/CreateMcpServerDialog'
import { McpCard } from '@/features/mcp/components/McpCard'
import { McpDetailDialog } from '@/features/mcp/components/McpDetailDialog'
import { useDeleteSkill, useSetSkillEnabled } from '@/features/skills/api/hooks'
import { CreateSkillDialog } from '@/features/skills/components/CreateSkillDialog'
import { SkillCard } from '@/features/skills/components/SkillCard'
import { SkillDetailDialog } from '@/features/skills/components/SkillDetailDialog'

import { useLibrary } from '../api/queries'
import { LibraryGroupCard } from '../components/LibraryGroupCard'
import { LibraryToolbar } from '../components/LibraryToolbar'
import { MCP_TRANSPORTS, serverGroupFacts, skillGroupFacts, type LibraryGroupFacts } from '../facts'
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
import { matchesTags, tagVocabulary } from '../tags'

type LibraryTab = 'skills' | 'mcp' | 'other'

/**
 * The lists the page walks before the report lands, and for the two tabs that are not open. One
 * identity, not a new `[]` per render: the derivations of the page are keyed on these.
 */
const NO_SKILLS: Skill[] = []
const NO_SERVERS: McpServer[] = []
const NO_RESOURCES: OtherResource[] = []

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
 * The grouped body of a tab. Grouping by agent always gets a group of its own, because the strip of
 * that group names the owner. Grouping by name only heads the names several agents share — the rest
 * fall into one plain list, so a library of mostly one-of-a-kind names does not become a wall of
 * one-card sections.
 *
 * Every group is one card, made the way a Hub source is: its strip is the fold control, its cards
 * sit on the canvas the card frames, and the run welds the cards `--group-gap` apart — so the page
 * reads as one stack of groups rather than a paste-up of separate cards, exactly as a collection of
 * sources does.
 *
 * A list starts with every group folded away — the library is everything this machine holds, and a
 * run of strips is its index — and keeps the ones the user opened for the session, keyed by the
 * list and the grouping: leaving the tab and coming back finds the list as it was left, exactly as
 * its filters do. The fold key names the group, so one list never folds a group of another.
 *
 * The blocks are mounted a batch of *rows* at a time, in the order the groups come: a library is
 * everything this machine holds — hundreds of cards, each one a card of its own with a switch and
 * a menu — so mounting it whole is a screen that paints late. The budget is one number for the tab
 * (`useLazyRows`) and a group is cut where it lands, which keeps the groups in order and never
 * leaves a heading without the cards it heads; the sentinel under the last mounted row asks for the
 * next batch. A folded group's rows are part of the count but not on screen, so folding a list away
 * shows less of what is below rather than mounting it.
 */
function LibrarySections<T extends { id: string }>({
  groups,
  mode,
  icon,
  renderItem,
  scope,
  factsOf,
}: {
  groups: LibraryGroup<T>[]
  mode: LibraryGroupMode
  icon: LucideIcon
  renderItem: (item: T) => ReactNode
  /** The list these groups belong to; its folds are kept per list and grouping. */
  scope: LibraryTab
  /** What one group of this list says about itself — see `facts.ts`. Reads its members only. */
  factsOf: (items: T[]) => LibraryGroupFacts
}) {
  const { t } = useTranslation()
  const [opened, setOpened] = useSessionState<string[]>(`library.expanded.${scope}.${mode}`, [])

  // The two halves of a by-name list — the names several agents share, and the one-of-a-kind ones
  // that need no strip of their own — together with what each group says about itself. Derived once
  // per list rather than once per render: the page re-renders on every keystroke and every fold, and
  // walking a group's members to describe it is exactly the work that would then be repeated.
  const { described, singles } = useMemo(() => {
    const named =
      mode === 'name'
        ? groups.filter((group) => group.items.length > 1 || group.agents.length > 1)
        : groups
    return {
      described: named.map((group) => ({ group, facts: factsOf(group.items) })),
      singles:
        mode === 'name'
          ? groups
              .filter((group) => group.items.length === 1 && group.agents.length === 1)
              .flatMap((group) => group.items)
          : [],
    }
  }, [groups, mode, factsOf])

  const foldKeyOf = (group: LibraryGroup<T>) => `${scope}.${mode}.${group.key}`
  // Folded until the user opens it: the store holds the groups that were opened, so an untouched
  // list is a run of strips and a restart starts the same way.
  const isFolded = (group: LibraryGroup<T>) => !opened.includes(foldKeyOf(group))
  // What the budget below is spent on: every card that will be mounted. A folded group is its
  // strip and nothing else, so it counts as the one row it is — counting the cards it hides would
  // spend the budget of the groups under it and leave a list that looks empty below the fold.
  const rows =
    described.reduce((total, { group }) => total + (isFolded(group) ? 1 : group.items.length), 0) +
    singles.length
  const { count, sentinelRef } = useLazyRows(rows, { resetKey: groups })

  const blocks: ReactNode[] = []
  let mounted = 0

  for (const { group, facts } of described) {
    if (mounted >= count) break
    const collapsed = isFolded(group)
    const shown = collapsed ? [] : group.items.slice(0, count - mounted)
    mounted += collapsed ? 1 : group.items.length
    const foldKey = foldKeyOf(group)
    const toggle = () => {
      setOpened((keys) =>
        keys.includes(foldKey) ? keys.filter((key) => key !== foldKey) : [...keys, foldKey],
      )
    }
    const owner = mode === 'agent' ? group.agents[0] : undefined
    const shared = owner !== undefined && isSharedOwner(owner.id)

    blocks.push(
      // One card per group, exactly as a Hub source wears one: the strip on top — which is also
      // where the group says what it is — and the cards on the canvas it frames.
      <LibraryGroupCard
        key={group.key}
        // The agent-neutral surface is not an agent: its header is named in the UI's language,
        // while a real agent keeps the manifest's name.
        title={shared ? t('library.shared') : group.title}
        owner={owner}
        owners={mode === 'name' ? group.agents : undefined}
        icon={icon}
        // A name held by a single entry does not need a count — its owners say it all.
        count={mode === 'agent' || group.items.length > 1 ? group.items.length : undefined}
        facts={facts}
        collapsed={collapsed}
        onToggle={toggle}
      >
        <AnimatedList>
          {shown.map((item) => (
            <Fragment key={item.id}>{renderItem(item)}</Fragment>
          ))}
        </AnimatedList>
      </LibraryGroupCard>,
    )
  }

  const singleCards = singles
    .slice(0, Math.max(0, count - mounted))
    .map((item) => <Fragment key={item.id}>{renderItem(item)}</Fragment>)

  return (
    <div className="flex flex-col gap-6">
      {/* The groups are one card run, the way a page of Hub sources is: welded `--group-gap`
          apart, only the ends of the stack keeping the full radius. The one-of-a-kind names below
          ride in the same run — they are rows of the same list, they just have no strip. A plain
          stack rather than an `AnimatedList`: a group is a whole block, and one leaving the list
          under a filter leaves at once, as it did before it was a card. */}
      <div className="ah-card-stack">
        {blocks}
        {singleCards}
      </div>
      {count < rows ? <div ref={sentinelRef} className="h-px w-full" aria-hidden /> : null}
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
  const favoriteIds = useFavoriteAgents()
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
  const [tags, setTags] = useSessionState<string[]>('library.tags', [])
  const [tab, setTab] = useSessionState<LibraryTab>('library.tab', 'skills')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [serverDetailId, setServerDetailId] = useState<string | null>(null)
  const [editTarget, setEditTarget] = useState<Skill | null>(null)
  const [deleteSkillTarget, setDeleteSkillTarget] = useState<Skill | null>(null)
  const [deleteServerTarget, setDeleteServerTarget] = useState<McpTarget | null>(null)
  // Which creation form is open; the owner is chosen inside it.
  const [createTarget, setCreateTarget] = useState<LibraryTab | null>(null)

  // Owners a new skill or server can belong to: the agent-neutral shared surface first (the
  // general case, and the default), then every installed agent — the pinned ones first, as in
  // every other picker. A resource written for an agent that is not installed would not be
  // scanned, so those are left out.
  const owners = useMemo<AgentRef[]>(
    () => [
      SHARED_OWNER,
      ...orderByFavorite(
        (agents.data?.agents ?? [])
          .filter((agent) => agent.status === 'installed')
          .map((agent) => ({ id: agent.id, name: agent.name, icon: agent.icon })),
        favoriteIds,
      ),
    ],
    [agents.data, favoriteIds],
  )

  // Every handler a card receives is stable: the cards are memoized (one card is a lot of markup
  // and the library holds hundreds of them), so a new function per render would redraw the whole
  // page every time anything above it changed.
  const toggleSkill = useCallback(
    (skill: Skill, enabled: boolean) => {
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
    },
    [setSkillEnabled, t],
  )
  const toggleServer = useCallback(
    (server: McpServer, enabled: boolean) => {
      setServerEnabled.mutate(
        { agentId: server.agent.id, serverId: server.id, enabled },
        {
          onSuccess: (result) => {
            toast.success(
              t(enabled ? 'mcp.toggledOn' : 'mcp.toggledOff', { name: result.data.name }),
            )
          },
          onError: (error) => toastAppError(error),
        },
      )
    },
    [setServerEnabled, t],
  )
  const openSkill = useCallback((skill: Skill) => setDetailId(skill.id), [])
  const openServer = useCallback((server: McpServer) => setServerDetailId(server.id), [])
  const editSkill = useCallback((skill: Skill) => setEditTarget(skill), [])
  const askDeleteSkill = useCallback((skill: Skill) => setDeleteSkillTarget(skill), [])
  const askDeleteServer = useCallback(
    (server: McpServer) => setDeleteServerTarget({ agentId: server.agent.id, serverId: server.id }),
    [],
  )

  // The tag row's own toggle: a tag is off or on, and several at once ask for a skill carrying any
  // of them — the Hub's rule for several tags, so the two screens answer the same question alike.
  const toggleTag = useCallback(
    (tag: string) =>
      setTags((current) =>
        current.includes(tag) ? current.filter((kept) => kept !== tag) : [...current, tag],
      ),
    [setTags],
  )

  // Every tab has its own facets and its own activity filter, so a refinement never survives a
  // switch to another tab. The tab itself is remembered with the rest, which keeps the two in
  // step: a revisit returns to the tab its facet belongs to.
  const switchTab = (value: string) => {
    setTab(value as LibraryTab)
    setFacet('all')
    setActivity('all')
    setTags([])
  }

  // The report in hand, or the same empties for every render until it lands: everything below is
  // keyed on these lists, and a fresh `[]` per render would re-derive the whole library each time.
  const allSkills = data?.skills ?? NO_SKILLS
  const allServers = data?.mcpServers ?? NO_SERVERS
  const allResources = data?.other ?? NO_RESOURCES
  const trimmed = query.trim()
  const sharedLabel = t('library.shared')

  // What the tab's own facet is applied *to*: the owning agent, the origin and the search text.
  // Each one is a whole pass over the library — hundreds of skills on a real machine, with a field
  // array built per item for the search — so it is derived once per input rather than once per
  // render: a keystroke, a dialog opening and a background refetch all re-render this page.
  const bases = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return {
      skills: allSkills.filter(
        (skill) =>
          ownedBy(skill.agents, agentFilter) &&
          originMatches(skill.agents, origin) &&
          matchesLibraryQuery(needle, [
            skill.name,
            skill.description,
            skill.path,
            ...skill.agents.map((agent) => ownerName(agent, sharedLabel)),
            ...skill.tags,
          ]),
      ),
      servers: allServers.filter(
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
      ),
      others: allResources.filter(
        (resource) =>
          ownedBy([resource.agent], agentFilter) &&
          originMatches([resource.agent], origin) &&
          matchesLibraryQuery(needle, [
            resource.label,
            resource.path,
            resource.description,
            ownerName(resource.agent, sharedLabel),
          ]),
      ),
    }
  }, [allSkills, allServers, allResources, agentFilter, origin, query, sharedLabel])

  // What the tag row offers: the tags the skills the search left behind declare, most-used first.
  // Derived from `bases`, never from the tag-narrowed list — a tag that is switched on has to stay
  // in the row while it is what narrows the list.
  const availableTags = useMemo(() => tagVocabulary(bases.skills), [bases])

  // Only the open tab is refined. Radix unmounts the tabs that are not on screen, but the JSX below
  // evaluates its arguments either way — so a tab that is not open is not walked, and neither is the
  // grouping below, which is the expensive half of this page.
  const skills = useMemo(
    () =>
      tab === 'skills'
        ? bases.skills.filter(
            (skill) =>
              matchesActivity(skill.enabled, activity) &&
              matchesTags(skill.tags, tags) &&
              (facet === 'all' || (facet === 'unverified' && skill.unverified)),
          )
        : NO_SKILLS,
    [tab, bases, activity, facet, tags],
  )
  const servers = useMemo(
    () =>
      tab === 'mcp'
        ? bases.servers.filter(
            (server) =>
              matchesActivity(server.enabled, activity) &&
              (facet === 'all' || server.transport.type === facet),
          )
        : NO_SERVERS,
    [tab, bases, activity, facet],
  )
  const others = useMemo(
    () =>
      tab === 'other'
        ? sortItems(
            bases.others.filter((resource) => facet === 'all' || resource.kind === facet),
            sort,
            resourceFields,
          )
        : NO_RESOURCES,
    [tab, bases, sort, facet],
  )

  // Grouping and ordering the tab that is open, once per list: `LibrarySections` is handed the
  // groups themselves, so a re-render of the page (any of the four that happen on the way in) does
  // not regroup the library or hand the sections a new array to walk.
  const skillGroups = useMemo(
    () => sortGroups(groupSkills(skills, groupMode), sort, skillFields),
    [skills, groupMode, sort],
  )
  const serverGroups = useMemo(
    () => sortGroups(groupServers(servers, groupMode), sort, serverFields),
    [servers, groupMode, sort],
  )

  // A tab badge is what that tab shows the moment it is opened. Switching tabs resets the facet
  // and the activity filter, so the inactive tab's badge must not follow the active tab's
  // refinement — otherwise narrowing one list looks like it emptied another.
  const skillBadge = tab === 'skills' ? skills.length : bases.skills.length
  const serverBadge = tab === 'mcp' ? servers.length : bases.servers.length
  const otherBadge = tab === 'other' ? others.length : bases.others.length

  /**
   * Facet chips for the active tab. A choice with nothing behind it is noise, but the *selected*
   * one always stays — otherwise narrowing the search could hide the very filter that made the
   * list empty.
   */
  const {
    skills: skillFacets,
    servers: serverFacets,
    others: otherFacets,
  } = useMemo(() => {
    const visible = <T extends { value: string; count?: number }>(options: T[]): T[] =>
      options.filter(
        (option) => option.value === 'all' || option.value === facet || (option.count ?? 0) > 0,
      )

    return {
      skills: visible([
        { value: 'all', label: t('common.all'), count: bases.skills.length },
        {
          value: 'unverified',
          label: t('library.facetUnverified'),
          count: bases.skills.filter((skill) => skill.unverified).length,
        },
      ]),
      servers: visible([
        { value: 'all', label: t('common.all'), count: bases.servers.length },
        ...MCP_TRANSPORTS.map((type) => ({
          value: type,
          label: type === 'unknown' ? t('common.unknown') : type,
          count: bases.servers.filter((server) => server.transport.type === type).length,
        })),
      ]),
      others: visible([
        { value: 'all', label: t('common.all'), count: bases.others.length },
        ...OTHER_KIND_ORDER.map((kind) => ({
          value: kind,
          label: t(`library.kind.${kind}`),
          count: bases.others.filter((resource) => resource.kind === kind).length,
        })),
      ]),
    }
  }, [bases, facet, t])

  // The agent filter lists what the *unfiltered* library holds, with the number of resources
  // each agent contributes, so the options never shift while the user is narrowing the list.
  // The pinned agents come first (the order every other agent list uses), the rest by name.
  const agentOptions = useMemo(() => {
    const refs = new Map<string, AgentRef>()
    const counts = new Map<string, number>()
    const count = (agent: AgentRef) => {
      refs.set(agent.id, agent)
      counts.set(agent.id, (counts.get(agent.id) ?? 0) + 1)
    }
    for (const skill of allSkills) for (const agent of skill.agents) count(agent)
    for (const server of allServers) count(server.agent)
    for (const resource of allResources) count(resource.agent)

    return [
      anyAgentOption(
        t('common.all'),
        String(allSkills.length + allServers.length + allResources.length),
      ),
      ...orderByFavorite(
        [...refs.values()].sort((a, b) =>
          ownerName(a, sharedLabel).localeCompare(ownerName(b, sharedLabel)),
        ),
        favoriteIds,
      ).map((agent) => ownerOption(agent, sharedLabel, String(counts.get(agent.id) ?? 0))),
    ]
  }, [allSkills, allServers, allResources, favoriteIds, sharedLabel, t])

  if (isLoading && !data) return <SkeletonList rows={5} />
  if (error && !data) return <ErrorState error={error} onRetry={() => void refetch()} />
  if (!data) return null

  // The dialog carries a switch, so it reads the live skill out of the library the mutation
  // refreshes instead of holding a snapshot that would show a stale state.
  const detail = allSkills.find((skill) => skill.id === detailId) ?? null
  // The MCP dialog carries a switch too, so it is read out of the list the mutation refreshes.
  const serverDetail = allServers.find((server) => server.id === serverDetailId) ?? null

  const dirty =
    trimmed.length > 0 ||
    agentFilter !== 'all' ||
    origin !== 'all' ||
    facet !== 'all' ||
    activity !== 'all' ||
    tags.length > 0
  const clear = () => {
    setQuery('')
    setAgentFilter('all')
    setOrigin('all')
    setFacet('all')
    setActivity('all')
    setTags([])
  }
  const clearAction = dirty ? (
    <Button variant="secondary" size="sm" onClick={clear}>
      {t('common.clearFilters')}
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
      scope="skills"
      factsOf={skillGroupFacts}
      renderItem={(skill) => (
        <SkillCard
          skill={skill}
          agents={groupMode === 'name' ? skill.agents : undefined}
          onOpen={openSkill}
          onEdit={editSkill}
          onDelete={askDeleteSkill}
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
      scope="mcp"
      factsOf={serverGroupFacts}
      renderItem={(server) => (
        <McpCard
          server={server}
          agents={groupMode === 'name' ? [server.agent] : undefined}
          onOpen={openServer}
          onDelete={askDeleteServer}
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
                items: tab === 'skills' ? bases.skills : bases.servers,
                value: activity,
                onChange: setActivity,
              }
        }
        tagFilter={
          tab === 'skills' ? { tags: availableTags, selected: tags, onToggle: toggleTag } : null
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
            : renderSkillSections(skillGroups)}
        </TabsContent>

        <TabsContent value="mcp">
          {servers.length === 0
            ? emptyTab(t('mcp.none'), t('mcp.noneHintCreate'), Plug, createAction('mcp'))
            : renderServerSections(serverGroups)}
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

      <McpDetailDialog
        server={serverDetail}
        open={serverDetail !== null}
        onOpenChange={(open) => {
          if (!open) setServerDetailId(null)
        }}
        onDelete={(server) => {
          setServerDetailId(null)
          askDeleteServer(server)
        }}
        onToggle={toggleServer}
        toggleBusy={
          setServerEnabled.isPending && setServerEnabled.variables?.serverId === serverDetail?.id
        }
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
