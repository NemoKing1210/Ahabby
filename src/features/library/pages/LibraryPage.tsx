import { Fragment, useCallback, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Boxes,
  ChevronDown,
  ChevronRight,
  Plug,
  Plus,
  RefreshCw,
  Server,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'

import type { AgentRef } from '@/shared/bindings/AgentRef'
import type { McpServer } from '@/shared/bindings/McpServer'
import type { OtherResource } from '@/shared/bindings/OtherResource'
import type { Skill } from '@/shared/bindings/Skill'
import { cn } from '@/shared/lib/cn'
import { matchesActivity, type ActivityFilter } from '@/shared/lib/activity'
import { formatRelative } from '@/shared/lib/format'
import { useLazyRows } from '@/shared/lib/lazyRows'
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
import { Tooltip } from '@/shared/ui/Tooltip'
import { anyAgentOption, ownerOption } from '@/shared/ui/agentOptions'

import { useScanRefresh } from '@/features/agents/api/scan'
import { useAgents, useFavoriteAgents } from '@/features/agents/api/queries'
import { OTHER_KIND_ORDER, OtherTab } from '@/features/agents/components/OtherTab'
import { orderByFavorite } from '@/features/agents/lib/favorites'
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
 * Heading of one group of a tab: the owner's tile (or the tab's icon), the title, the count of
 * what the group holds, and the agents that share it.
 *
 * Given a fold state it is also the fold control — the chevron beside it and the heading itself
 * fold the cards below away, which is what keeps a library holding many near-identical names
 * readable. A group that does not fold renders the same heading without the control.
 *
 * The fold is what the heading looks like, too: it is the *first row of the group's card run*,
 * so a folded group is a lone card of the list and an open one is the block's caption band.
 */
function LibraryGroupHeading<T extends { id: string }>({
  group,
  mode,
  icon,
  collapsed,
  onToggle,
}: {
  group: LibraryGroup<T>
  mode: LibraryGroupMode
  icon: LucideIcon
  /** Fold state of the group; omit it for a heading that is not a control. */
  collapsed?: boolean
  onToggle?: () => void
}) {
  const { t } = useTranslation()
  const owner = mode === 'agent' ? group.agents[0] : undefined
  const shared = owner !== undefined && isSharedOwner(owner.id)
  // The agent-neutral surface is not an agent: its header is named in the UI's language, while a
  // real agent keeps the manifest's name.
  const title = shared ? t('library.shared') : group.title

  const heading = (
    <SectionHeader
      className="w-full"
      leading={
        owner ? (
          <AgentIcon name={owner.name} icon={owner.icon} ownerId={owner.id} size="sm" />
        ) : undefined
      }
      icon={icon}
      title={title}
      // A name held by a single entry does not need a count — its owners say it all.
      count={mode === 'agent' || group.items.length > 1 ? group.items.length : undefined}
    >
      {/* The owners are the group's far end: pushed to the edge of the strip, the title and
          its count stay in the same column down the whole list. */}
      {mode === 'name' ? (
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {group.agents.map((agent) => (
            <AgentTag key={agent.id} agent={agent} />
          ))}
        </span>
      ) : null}
    </SectionHeader>
  )

  if (collapsed === undefined || onToggle === undefined) return heading

  const label = collapsed
    ? t('library.expandGroup', { name: title })
    : t('library.collapseGroup', { name: title })

  return (
    // The heading is the first row of the group's own card run, and the run decides its corners:
    // folded away it is a plain card of the list, wearing the surface and the lift the cards
    // beside it wear; open it is the tinted band those cards hang under, welded to the first of
    // them. The state is the look itself, not only the chevron.
    <div
      className={cn(
        'border-border ease-warm flex min-w-0 items-center gap-1 rounded-xl border px-2.5 py-2 transition-[background-color,border-color,translate] duration-150',
        collapsed
          ? 'bg-surface hover:border-border-strong hover:-translate-y-px'
          : 'bg-surface-2/60 hover:bg-surface-2/80',
      )}
    >
      <Tooltip content={label}>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          aria-expanded={!collapsed}
          aria-label={label}
          onClick={onToggle}
        >
          {collapsed ? (
            <ChevronRight className="size-3.5" aria-hidden />
          ) : (
            <ChevronDown className="size-3.5" aria-hidden />
          )}
        </Button>
      </Tooltip>
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={onToggle}
        className="focus-visible:outline-ring flex min-w-0 flex-1 items-center rounded-lg px-1 py-0.5 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {heading}
      </button>
    </div>
  )
}

/**
 * The grouped body of a tab. Grouping by agent always gets a header, because the header *is*
 * the owner. Grouping by name only heads the names several agents share — the rest fall into
 * one plain list, so a library of mostly one-of-a-kind names does not become a wall of
 * one-card sections.
 *
 * A foldable list starts with every group folded away — the library is everything this machine
 * holds, and a run of headings is its index — and keeps the ones the user opened for the session,
 * keyed by the list and the grouping: leaving the tab and coming back finds the list as it was
 * left, exactly as its filters do. The fold key names the group, so one list never folds a group
 * of another.
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
  foldable = false,
}: {
  groups: LibraryGroup<T>[]
  mode: LibraryGroupMode
  icon: LucideIcon
  renderItem: (item: T) => ReactNode
  /** The list these groups belong to; its folds are kept per list and grouping. */
  scope: LibraryTab
  /** Whether a group of this list can be folded away. */
  foldable?: boolean
}) {
  const [opened, setOpened] = useSessionState<string[]>(`library.expanded.${scope}.${mode}`, [])
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
  const foldKeyOf = (group: LibraryGroup<T>) => `${scope}.${mode}.${group.key}`
  // Folded until the user opens it: the store holds the groups that were opened, so an untouched
  // list is a run of headings and a restart starts the same way.
  const isFolded = (group: LibraryGroup<T>) => foldable && !opened.includes(foldKeyOf(group))
  // What the budget below is spent on: every card that will be mounted. A folded group is its
  // heading and nothing else, so it counts as the one row it is — counting the cards it hides would
  // spend the budget of the groups under it and leave a list that looks empty below the fold.
  const rows =
    named.reduce((total, group) => total + (isFolded(group) ? 1 : group.items.length), 0) +
    singles.length
  const { count, sentinelRef } = useLazyRows(rows, { resetKey: groups })

  const blocks: ReactNode[] = []
  let mounted = 0

  for (const group of named) {
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
    const heading = (
      <LibraryGroupHeading
        group={group}
        mode={mode}
        icon={icon}
        collapsed={foldable ? collapsed : undefined}
        onToggle={foldable ? toggle : undefined}
      />
    )
    const cards = shown.map((item) => <Fragment key={item.id}>{renderItem(item)}</Fragment>)

    blocks.push(
      <section key={group.key} className="flex flex-col gap-2">
        {/* A foldable group's heading and its cards are one run — the heading is its first
            row, so the run is what rounds it: a card like any other while the group is folded
            away, the block's caption band while its cards hang under it. Folding is then the
            rows leaving the run, with the motion a filtered row already leaves with. */}
        {foldable ? (
          <AnimatedList>
            <Fragment key="heading">{heading}</Fragment>
            {collapsed ? null : cards}
          </AnimatedList>
        ) : (
          <>
            {heading}
            <AnimatedList>{cards}</AnimatedList>
          </>
        )}
      </section>,
    )
  }

  const singleCards = singles
    .slice(0, Math.max(0, count - mounted))
    .map((item) => <Fragment key={item.id}>{renderItem(item)}</Fragment>)

  return (
    <div className="flex flex-col gap-6">
      {blocks}
      {singleCards.length > 0 ? <AnimatedList>{singleCards}</AnimatedList> : null}
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
  const [tab, setTab] = useSessionState<LibraryTab>('library.tab', 'skills')
  const [detailId, setDetailId] = useState<string | null>(null)
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
  const editSkill = useCallback((skill: Skill) => setEditTarget(skill), [])
  const askDeleteSkill = useCallback((skill: Skill) => setDeleteSkillTarget(skill), [])
  const askDeleteServer = useCallback(
    (server: McpServer) => setDeleteServerTarget({ agentId: server.agent.id, serverId: server.id }),
    [],
  )

  // Every tab has its own facets and its own activity filter, so a refinement never survives a
  // switch to another tab. The tab itself is remembered with the rest, which keeps the two in
  // step: a revisit returns to the tab its facet belongs to.
  const switchTab = (value: string) => {
    setTab(value as LibraryTab)
    setFacet('all')
    setActivity('all')
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

  // Only the open tab is refined. Radix unmounts the tabs that are not on screen, but the JSX below
  // evaluates its arguments either way — so a tab that is not open is not walked, and neither is the
  // grouping below, which is the expensive half of this page.
  const skills = useMemo(
    () =>
      tab === 'skills'
        ? bases.skills.filter(
            (skill) =>
              matchesActivity(skill.enabled, activity) &&
              (facet === 'all' || (facet === 'unverified' && skill.unverified)),
          )
        : NO_SKILLS,
    [tab, bases, activity, facet],
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
      scope="skills"
      foldable
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
      foldable
      renderItem={(server) => (
        <McpCard
          server={server}
          agents={groupMode === 'name' ? [server.agent] : undefined}
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
