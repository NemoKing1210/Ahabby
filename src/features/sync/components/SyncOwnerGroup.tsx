import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'

import type { AgentRef } from '@/shared/bindings/AgentRef'
import { useSessionState } from '@/shared/lib/sessionState'
import { ownerName } from '@/shared/lib/owners'
import { AgentIcon } from '@/shared/ui/AgentIcon'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Reveal } from '@/shared/ui/Reveal'
import { Tooltip } from '@/shared/ui/Tooltip'

/**
 * One owner's items: a foldable heading with the owner's own tile, what its group holds, and the
 * quick actions that apply to the whole group.
 *
 * The heading is the fold control (a button, so the keyboard works), and the actions stay on
 * screen while the group is folded — saving or restoring a whole owner never needs the list open.
 * Collapse is kept for the session, keyed by the tab and the owner, so scrolling away and back
 * finds the library as it was left.
 */
export function SyncOwnerGroup({
  owner,
  count,
  pending,
  changed,
  collapsedKey,
  actions,
  children,
}: {
  owner: AgentRef
  /** Items of this group, after the screen's own filters. */
  count: number
  /** How many of them are not saved yet — a warning badge, omitted when there are none. */
  pending?: number
  /** How many changed since the last save — an accent badge, omitted when there are none. */
  changed?: number
  /** Session key the fold is remembered under. */
  collapsedKey: string
  /** Quick actions of the group (save all, restore all, select all). */
  actions?: ReactNode
  /** The rows themselves; each needs its own `key`. */
  children: ReactNode
}) {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useSessionState(collapsedKey, false)
  const name = ownerName(owner, t('library.shared'))
  const toggleLabel = collapsed
    ? t('sync.expandOwner', { name })
    : t('sync.collapseOwner', { name })
  const toggle = () => setCollapsed((value) => !value)

  return (
    <section className="flex flex-col gap-2">
      <div className="border-border bg-surface-2/60 flex flex-wrap items-center gap-2 rounded-xl border px-2.5 py-2">
        <Tooltip content={toggleLabel}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-expanded={!collapsed}
            aria-label={toggleLabel}
            onClick={toggle}
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
          onClick={toggle}
          className="focus-visible:outline-ring flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1 py-0.5 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <AgentIcon name={name} icon={owner.icon} ownerId={owner.id} size="sm" />
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-[0.9375rem] font-medium">{name}</span>
            <Badge tone="neutral">{count}</Badge>
            {pending ? <Badge tone="warning">{t('sync.pending', { count: pending })}</Badge> : null}
            {changed ? <Badge tone="accent">{t('sync.changed', { count: changed })}</Badge> : null}
          </span>
        </button>

        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>

      {/* The rows are the cards of a page list, so they are one concentric run (`.ah-card-group`,
          rendered by `AnimatedList` itself): a `--group-gap` apart, with only the corners at the
          exposed ends keeping the full radius — the same treatment the agent list uses. */}
      <Reveal open={!collapsed}>
        <AnimatedList as="ul">{children}</AnimatedList>
      </Reveal>
    </section>
  )
}
