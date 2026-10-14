import { useCallback, useMemo, useState, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown,
  ChevronUp,
  Columns2,
  Grid2x2,
  Maximize2,
  Minimize2,
  Plus,
  Rows2,
  Square,
  SquareX,
  Terminal as TerminalIcon,
  X,
} from 'lucide-react'

import { cn } from '@/shared/lib/cn'
import { fileName } from '@/shared/lib/format'
import { AgentIcon } from '@/shared/ui/AgentIcon'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { Tooltip } from '@/shared/ui/Tooltip'
import { toastAppError } from '@/shared/ui/Toast'

import { useAgents } from '@/features/agents/api/queries'

import { useCloseTerminal, useLaunchTerminal } from '../api/hooks'
import { startPointerDrag } from '../lib/drag'
import { canAdoptLayout, paneCount } from '../lib/layout'
import { shortenCommand } from '../lib/terminal'
import {
  useTerminalStore,
  type TerminalLayout,
  type TerminalPane,
  type TerminalSessionState,
  type TerminalWorkspace,
} from '../store'
import { PaneGrid } from './PaneGrid'
import { TerminalPane as Pane } from './TerminalPane'

/** The dock may not be dragged smaller than this, or a whole one is unusable. */
const MIN_HEIGHT = 140
/** …nor taller than this share of the window, or the app itself is unusable. */
const MAX_HEIGHT_RATIO = 0.75
const DEFAULT_HEIGHT = 320

/** The arrangements a workspace may wear, in the order the buttons are drawn. */
const LAYOUTS: { id: TerminalLayout; labelKey: string; icon: typeof Square }[] = [
  { id: 'single', labelKey: 'terminal.layoutSingle', icon: Square },
  { id: 'columns', labelKey: 'terminal.layoutColumns', icon: Columns2 },
  { id: 'rows', labelKey: 'terminal.layoutRows', icon: Rows2 },
  { id: 'grid', labelKey: 'terminal.layoutGrid', icon: Grid2x2 },
]

/**
 * The docked terminal: a footer that belongs to the window rather than a screen of its own.
 *
 * Its tab strip is always on screen — one row per *workspace*, naming the agent its focused pane
 * holds — so several sets of agents stay visible and switchable while the rest of the interface is
 * used above them. Collapsing it keeps the rows and keeps every pane mounted: a background agent
 * goes on painting into its own scrollback, and nothing is lost by making room. The top edge is a
 * drag handle, which is what makes the height the user's decision; the dividers inside a split
 * workspace make each pane's share theirs.
 *
 * Maximized, the same dock takes the whole window: `AppShell` stands the screen and the rail down
 * (`maximized` in the store is what it reads), the panel becomes the content column's flexible row,
 * and the height stops being the user's — so the drag handle goes with it.
 */
export function TerminalDock({
  onNew,
}: {
  onNew: (into?: { paneId: string; cwd: string }) => void
}) {
  const { t } = useTranslation()
  const workspaces = useTerminalStore((state) => state.workspaces)
  const sessions = useTerminalStore((state) => state.sessions)
  const activeId = useTerminalStore((state) => state.activeId)
  const expanded = useTerminalStore((state) => state.expanded)
  const maximized = useTerminalStore((state) => state.maximized)
  const activate = useTerminalStore((state) => state.activate)
  const focusPane = useTerminalStore((state) => state.focusPane)
  const setLayout = useTerminalStore((state) => state.setLayout)
  const setSizes = useTerminalStore((state) => state.setSizes)
  const setExpanded = useTerminalStore((state) => state.setExpanded)
  const toggleMaximized = useTerminalStore((state) => state.toggleMaximized)
  const replaceSession = useTerminalStore((state) => state.replaceSession)
  const closeTerminal = useCloseTerminal()
  const restart = useLaunchTerminal()
  const { data: report } = useAgents()

  const [height, setHeight] = useState(DEFAULT_HEIGHT)
  const [confirmingCloseAll, setConfirmingCloseAll] = useState(false)
  /** The workspace a close was asked of, waiting to be answered. */
  const [closingId, setClosingId] = useState<string | null>(null)

  const icons = useMemo(() => {
    const byId = new Map<string, string | null>()
    for (const agent of report?.agents ?? []) byId.set(agent.id, agent.icon ?? null)
    return byId
  }, [report])

  // The workspace on screen: the active one, or the last — the fallback the store keeps for the
  // pointer keys, and the one that keeps the dock usable while a workspace is being closed.
  const workspace =
    workspaces.find((candidate) => candidate.id === activeId) ?? workspaces[workspaces.length - 1]
  const closing = workspaces.find((candidate) => candidate.id === closingId)
  const sessionCount = Object.keys(sessions).length

  /**
   * Where an agent started from a pane works: the directory this workspace already works in.
   *
   * Read from the first pane that holds a session rather than from the focused one: pressing a
   * pane's button focuses that pane first, and an empty pane has no directory of its own to give.
   */
  const workspaceCwd = useMemo(() => {
    for (const pane of workspace?.panes ?? []) {
      const held = pane.sessionId ? sessions[pane.sessionId] : undefined
      if (held) return held.cwd
    }
    return ''
  }, [workspace, sessions])

  /** Every session of a workspace, gone together — the way its tab used to go. */
  const closeWorkspace = useCallback(
    (target: TerminalWorkspace) => {
      for (const pane of target.panes) {
        if (pane.sessionId !== null) closeTerminal(pane.sessionId)
      }
      setClosingId(null)
    },
    [closeTerminal],
  )

  /** One agent is the tab the user is looking at; several of them are worth a question first. */
  const requestClose = useCallback(
    (target: TerminalWorkspace) => {
      const held = target.panes.filter((pane) => pane.sessionId !== null).length
      if (held > 1) setClosingId(target.id)
      else closeWorkspace(target)
    },
    [closeWorkspace],
  )

  /**
   * Restart a pane's agent in its own pane. The new session takes the pane **first**: closing the
   * dead one would empty a one-pane workspace and take it away, leaving the agent that had just
   * started with nowhere to live.
   */
  const restartInPane = useCallback(
    (pane: TerminalPane, session: TerminalSessionState | null) => {
      if (!session) return
      restart.mutate(
        { agentId: session.agentId, cwd: session.cwd },
        {
          onSuccess: (started) => {
            replaceSession(pane.id, started)
            closeTerminal(session.sessionId)
          },
          onError: (error) => toastAppError(error),
        },
      )
    },
    [closeTerminal, replaceSession, restart],
  )

  /** Drag the top edge: up grows the dock, down shrinks it; the interface above follows. */
  const startResize = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const startY = event.clientY
      const startHeight = height
      const ceiling = Math.max(MIN_HEIGHT, window.innerHeight * MAX_HEIGHT_RATIO)
      const clamp = (value: number) => Math.min(ceiling, Math.max(MIN_HEIGHT, value))
      startPointerDrag(event, {
        cursor: 'row-resize',
        onMove: (moveEvent) => setHeight(clamp(startHeight + (startY - moveEvent.clientY))),
      })
    },
    [height],
  )

  // `TerminalView` hands the keyboard back when a pane loses the focus (it blurs its own terminal),
  // because a pane that is not the focused one would swallow every key the app expects.

  return (
    <section
      aria-label={t('terminal.panel')}
      className={cn(
        'border-border bg-surface shadow-panel ease-warm flex flex-col overflow-hidden rounded-2xl border duration-150',
        // Maximized, the panel is the content column's flexible row behind the screen the shell
        // stood down; docked, it keeps its place at the end of that column.
        maximized ? 'min-h-0 flex-1' : 'shrink-0',
      )}
    >
      {expanded && !maximized ? (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={t('terminal.resize')}
          onPointerDown={startResize}
          onDoubleClick={() => setHeight(DEFAULT_HEIGHT)}
          className="group h-2 shrink-0 cursor-row-resize pt-1"
        >
          <span
            aria-hidden
            className="bg-border-strong mx-auto block h-0.5 w-14 rounded-full opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          />
        </div>
      ) : null}

      <div className="flex items-center gap-1 px-2 py-1.5">
        <span className="text-faint flex shrink-0 items-center gap-1.5 pr-1 pl-1">
          <TerminalIcon className="size-3.5" aria-hidden />
          <span className="text-[0.6875rem] font-medium tracking-wide uppercase">
            {t('terminal.panel')}
          </span>
        </span>

        <div
          role="tablist"
          aria-label={t('terminal.tabs')}
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        >
          <AnimatedList
            grouped={false}
            itemClassName="shrink-0"
            className="flex items-center gap-1"
          >
            {workspaces.map((item) => {
              const selected = item.id === workspace?.id
              // The row names the agent the workspace is showing: the focused pane when it holds a
              // session, and otherwise the first pane that does — a row is a way back to an agent,
              // never a label for an empty slot.
              const held =
                item.panes.find(
                  (pane) => pane.id === item.activePaneId && pane.sessionId !== null,
                ) ?? item.panes.find((pane) => pane.sessionId !== null)
              const session = held?.sessionId ? sessions[held.sessionId] : undefined
              const title = item.panes
                .map((pane) => {
                  const inside = pane.sessionId ? sessions[pane.sessionId] : undefined
                  return inside ? `${inside.agentName} · ${shortenCommand(inside.command)}` : ''
                })
                .filter((line) => line.length > 0)
                .join(', ')

              return (
                <div
                  key={item.id}
                  className={cn(
                    'group ease-warm flex shrink-0 items-center gap-0.5 rounded-xl pr-0.5 pl-1.5 transition-colors duration-150',
                    selected && expanded
                      ? 'bg-accent-soft text-accent-strong'
                      : 'hover:bg-surface-2',
                  )}
                >
                  <Tooltip content={title} side="top">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => activate(item.id)}
                      className={cn(
                        'flex items-center gap-1.5 py-1 pr-1 text-[0.8125rem]',
                        selected ? 'text-accent-strong' : 'text-muted hover:text-foreground',
                      )}
                    >
                      {session ? (
                        <AgentIcon
                          name={session.agentName}
                          icon={icons.get(session.agentId)}
                          size="xs"
                        />
                      ) : null}
                      <span className="max-w-40 truncate">{session?.agentName ?? ''}</span>
                      {item.panes.length > 1 ? (
                        <Badge tone="neutral" className="tabular-nums">
                          {item.panes.length}
                        </Badge>
                      ) : null}
                      {session ? (
                        <span className="text-faint max-w-24 truncate text-[0.6875rem]">
                          {fileName(session.cwd)}
                        </span>
                      ) : null}
                      {session && !session.running ? (
                        <span className="text-faint text-[0.6875rem]">
                          {t('terminal.exitedShort', { code: session.exitCode ?? '—' })}
                        </span>
                      ) : null}
                    </button>
                  </Tooltip>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-6 opacity-60 group-hover:opacity-100"
                    aria-label={t('terminal.closeWorkspaceAria')}
                    onClick={() => requestClose(item)}
                  >
                    <X className="size-3" aria-hidden />
                  </Button>
                </div>
              )
            })}
          </AnimatedList>
        </div>

        <div
          role="group"
          aria-label={t('terminal.layout')}
          className="border-border bg-surface-2 flex shrink-0 items-center gap-0.5 rounded-xl border p-0.5"
        >
          {LAYOUTS.map((option) => {
            const allowed = workspace ? canAdoptLayout(workspace.panes, option.id) : false
            const held = workspace
              ? workspace.panes.filter((pane) => pane.sessionId !== null).length
              : 0
            const label = t(option.labelKey)
            return (
              <Tooltip key={option.id} content={label} side="top">
                <Button
                  variant={workspace?.layout === option.id ? 'subtle' : 'ghost'}
                  size="icon-sm"
                  className="size-6"
                  aria-label={label}
                  aria-pressed={workspace?.layout === option.id}
                  disabled={!allowed}
                  // A button that cannot be pressed still has to say what stands in the way.
                  title={
                    allowed
                      ? undefined
                      : t('terminal.layoutBlocked', { count: held - paneCount(option.id) })
                  }
                  onClick={() => setLayout(option.id)}
                >
                  <option.icon className="size-3.5" aria-hidden />
                </Button>
              </Tooltip>
            )
          })}
        </div>

        <Tooltip content={t('terminal.new')} side="top">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('terminal.new')}
            onClick={() => onNew()}
          >
            <Plus className="size-4" aria-hidden />
          </Button>
        </Tooltip>
        <Tooltip content={t('terminal.closeAll')} side="top">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('terminal.closeAll')}
            onClick={() => setConfirmingCloseAll(true)}
          >
            <SquareX className="size-4" aria-hidden />
          </Button>
        </Tooltip>
        <Tooltip content={maximized ? t('terminal.restore') : t('terminal.maximize')} side="top">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={maximized ? t('terminal.restore') : t('terminal.maximize')}
            aria-pressed={maximized}
            onClick={toggleMaximized}
          >
            {maximized ? (
              <Minimize2 className="size-4" aria-hidden />
            ) : (
              <Maximize2 className="size-4" aria-hidden />
            )}
          </Button>
        </Tooltip>
        <Tooltip content={expanded ? t('terminal.collapse') : t('terminal.expand')} side="top">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={expanded ? t('terminal.collapse') : t('terminal.expand')}
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <ChevronDown className="size-4" aria-hidden />
            ) : (
              <ChevronUp className="size-4" aria-hidden />
            )}
          </Button>
        </Tooltip>
      </div>

      <div
        // Collapsed means zero height, not unmounted: the panes keep their scrollback. A maximized
        // dock is a flexible row instead, because its height is the window's then.
        style={!expanded ? { height: 0 } : maximized ? undefined : { height }}
        className={cn(
          'relative flex min-h-0 flex-col overflow-hidden',
          expanded && maximized && 'flex-1',
        )}
      >
        {workspace ? (
          <PaneGrid layout={workspace.layout} sizes={workspace.sizes} onResize={setSizes}>
            {workspace.panes.map((pane) => {
              const session = pane.sessionId ? (sessions[pane.sessionId] ?? null) : null
              return (
                <Pane
                  key={pane.id}
                  session={session}
                  titled={workspace.panes.length > 1}
                  // The keyboard belongs to the focused pane of an *open* dock: collapsed, there is
                  // no room for it and the app must get its keys back.
                  focused={expanded && pane.id === workspace.activePaneId}
                  restarting={restart.isPending}
                  icon={session ? icons.get(session.agentId) : null}
                  onFocus={() => focusPane(pane.id)}
                  // A pane starts where its neighbours work, so a split does not ask for the same
                  // path twice.
                  onStart={() => onNew({ paneId: pane.id, cwd: workspaceCwd })}
                  onRestart={() => restartInPane(pane, session)}
                  onClose={() => {
                    if (session) closeTerminal(session.sessionId)
                  }}
                />
              )
            })}
          </PaneGrid>
        ) : null}
      </div>

      {/* The one question a dock-wide close is worth asking: an agent in another tab is work in
          progress, and ending its session takes the scrollback with it. */}
      {confirmingCloseAll ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => (next ? undefined : setConfirmingCloseAll(false))}
          title={t('terminal.closeAllTitle')}
          description={t('terminal.closeAllDescription', { count: sessionCount })}
          confirmLabel={t('terminal.closeAllConfirm')}
          onConfirm={() => {
            for (const sessionId of Object.keys(sessions)) closeTerminal(sessionId)
            setConfirmingCloseAll(false)
          }}
        />
      ) : null}

      {/* Closing a workspace ends every agent in it: one of them needs no question, several do. */}
      {closing ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => (next ? undefined : setClosingId(null))}
          title={t('terminal.closeWorkspaceTitle')}
          description={t('terminal.closeWorkspaceDescription', {
            count: closing.panes.filter((pane) => pane.sessionId !== null).length,
          })}
          confirmLabel={t('terminal.closeWorkspace')}
          onConfirm={() => closeWorkspace(closing)}
        />
      ) : null}
    </section>
  )
}
