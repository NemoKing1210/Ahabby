import { useCallback, useMemo, useState, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, Plus, RotateCcw, Terminal as TerminalIcon, X } from 'lucide-react'

import { cn } from '@/shared/lib/cn'
import { fileName } from '@/shared/lib/format'
import { AgentIcon } from '@/shared/ui/AgentIcon'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Button } from '@/shared/ui/Button'
import { Tooltip } from '@/shared/ui/Tooltip'
import { toastAppError } from '@/shared/ui/Toast'

import { useAgents } from '@/features/agents/api/queries'

import { useCloseTerminal, useLaunchTerminal } from '../api/hooks'
import { shortenCommand } from '../lib/terminal'
import { useTerminalStore } from '../store'
import { TerminalView } from './TerminalView'

/** The dock may not be dragged smaller than this, or a whole one is unusable. */
const MIN_HEIGHT = 140
/** …nor taller than this share of the window, or the app itself is unusable. */
const MAX_HEIGHT_RATIO = 0.75
const DEFAULT_HEIGHT = 320

/**
 * The docked terminal: a footer that belongs to the window rather than a screen of its own.
 *
 * Its tab strip is always on screen, so several agents stay visible and switchable while the rest
 * of the interface is being used above them; collapsing it keeps the tabs and keeps every terminal
 * mounted — a background agent goes on painting into its own scrollback, and nothing is lost by
 * making room. The top edge is a drag handle, which is what makes the height the user's decision.
 */
export function TerminalDock({ onNew }: { onNew: () => void }) {
  const { t } = useTranslation()
  const tabs = useTerminalStore((state) => state.tabs)
  const activeId = useTerminalStore((state) => state.activeId)
  const expanded = useTerminalStore((state) => state.expanded)
  const activate = useTerminalStore((state) => state.activate)
  const setExpanded = useTerminalStore((state) => state.setExpanded)
  const open = useTerminalStore((state) => state.open)
  const closeTerminal = useCloseTerminal()
  const restart = useLaunchTerminal()
  const { data: report } = useAgents()

  const [height, setHeight] = useState(DEFAULT_HEIGHT)

  const icons = useMemo(() => {
    const byId = new Map<string, string | null>()
    for (const agent of report?.agents ?? []) byId.set(agent.id, agent.icon ?? null)
    return byId
  }, [report])

  const active = tabs.find((tab) => tab.sessionId === activeId) ?? tabs[tabs.length - 1]

  /** Drag the top edge: up grows the dock, down shrinks it; the interface above follows. */
  const startResize = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      const startY = event.clientY
      const startHeight = height
      const ceiling = Math.max(MIN_HEIGHT, window.innerHeight * MAX_HEIGHT_RATIO)
      const clamp = (value: number) => Math.min(ceiling, Math.max(MIN_HEIGHT, value))
      const move = (moveEvent: globalThis.PointerEvent) =>
        setHeight(clamp(startHeight + (startY - moveEvent.clientY)))
      const stop = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', stop)
        document.body.style.removeProperty('cursor')
        document.body.style.removeProperty('user-select')
      }
      // The cursor and the selection have to stay put for the whole drag, not just over the handle.
      document.body.style.cursor = 'row-resize'
      document.body.style.userSelect = 'none'
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', stop)
    },
    [height],
  )

  // `TerminalView` hands the keyboard back when the dock is collapsed (it blurs its own terminal),
  // because a hidden terminal that still owns the focus would swallow every key the app expects.

  return (
    <section
      aria-label={t('terminal.panel')}
      className="border-border bg-surface shadow-panel ease-warm flex shrink-0 flex-col overflow-hidden rounded-2xl border duration-150"
    >
      {expanded ? (
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
            {tabs.map((tab) => {
              const selected = tab.sessionId === active?.sessionId
              return (
                <div
                  key={tab.sessionId}
                  className={cn(
                    'group ease-warm flex shrink-0 items-center gap-0.5 rounded-xl pr-0.5 pl-1.5 transition-colors duration-150',
                    selected && expanded
                      ? 'bg-accent-soft text-accent-strong'
                      : 'hover:bg-surface-2',
                  )}
                >
                  <Tooltip content={shortenCommand(tab.command)} side="top">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => activate(tab.sessionId)}
                      className={cn(
                        'flex items-center gap-1.5 py-1 pr-1 text-[0.8125rem]',
                        selected ? 'text-accent-strong' : 'text-muted hover:text-foreground',
                      )}
                    >
                      <AgentIcon name={tab.agentName} icon={icons.get(tab.agentId)} size="xs" />
                      <span className="max-w-40 truncate">{tab.agentName}</span>
                      <span className="text-faint max-w-24 truncate text-[0.6875rem]">
                        {fileName(tab.cwd)}
                      </span>
                      {tab.running ? null : (
                        <span className="text-faint text-[0.6875rem]">
                          {t('terminal.exitedShort', { code: tab.exitCode ?? '—' })}
                        </span>
                      )}
                    </button>
                  </Tooltip>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-6 opacity-60 group-hover:opacity-100"
                    aria-label={t('terminal.closeTab', { agent: tab.agentName })}
                    onClick={() => closeTerminal(tab.sessionId)}
                  >
                    <X className="size-3" aria-hidden />
                  </Button>
                </div>
              )
            })}
          </AnimatedList>
        </div>

        <Tooltip content={t('terminal.new')} side="top">
          <Button variant="ghost" size="icon-sm" aria-label={t('terminal.new')} onClick={onNew}>
            <Plus className="size-4" aria-hidden />
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
        // Collapsed means zero height, not unmounted: the terminals keep their scrollback.
        style={{ height: expanded ? height : 0 }}
        className="relative flex min-h-0 flex-col overflow-hidden"
      >
        <div className="relative min-h-0 flex-1">
          {tabs.map((tab) => (
            <TerminalView
              key={tab.sessionId}
              session={tab}
              active={tab.sessionId === active?.sessionId}
              focusable={expanded}
            />
          ))}
        </div>

        {/* The ended session takes its own strip instead of floating over the terminal: the last
            rows an agent printed are exactly the ones a user needs to read. */}
        {active && !active.running ? (
          <div className="border-border bg-surface-2 flex shrink-0 flex-wrap items-center justify-between gap-3 border-t px-3 py-2">
            <span className="text-muted text-[0.8125rem]">
              {t('terminal.exited', { code: active.exitCode ?? '—' })}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                loading={restart.isPending}
                onClick={() =>
                  restart.mutate(
                    { agentId: active.agentId, cwd: active.cwd },
                    {
                      onSuccess: (session) => {
                        open(session)
                        closeTerminal(active.sessionId)
                      },
                      onError: (error) => toastAppError(error),
                    },
                  )
                }
              >
                {restart.isPending ? null : <RotateCcw className="size-3.5" aria-hidden />}
                {t('terminal.restart')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => closeTerminal(active.sessionId)}>
                {t('terminal.closeTabAction')}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
