import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'

import type { AgentRef } from '@/shared/bindings/AgentRef'
import { cn } from '@/shared/lib/cn'
import { useSessionState } from '@/shared/lib/sessionState'
import { ownerName } from '@/shared/lib/owners'
import { AgentIcon } from '@/shared/ui/AgentIcon'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Reveal } from '@/shared/ui/Reveal'
import { SectionHeader } from '@/shared/ui/SectionHeader'
import { Tooltip } from '@/shared/ui/Tooltip'

/**
 * One owner's items: a foldable heading with the owner's own tile, what its group holds, and the
 * quick actions that apply to the whole group.
 *
 * A group starts folded away — the owners are what the user reads first, and the list behind one of
 * them is long — so the session holds the groups that were *opened* (`useSessionState`, keyed by the
 * half of the library and the owner), exactly as the Library and the Hub keep their folds.
 *
 * The group *is* the card: its heading is the strip, its rows sit on the canvas inside it, and the
 * page welds the groups into a run of their own (`AnimatedList`) — so the library reads the way a
 * collection of the Hub does, at the same size and with the same fold.
 *
 * The heading is the fold control (a button, so the keyboard works), and the actions stay on
 * screen while the group is folded — saving or restoring a whole owner never needs the list open.
 */
export function SyncOwnerGroup({
  owner,
  count,
  pending,
  changed,
  expandedKey,
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
  expandedKey: string
  /** Quick actions of the group (save all, restore all, select all). */
  actions?: ReactNode
  /** The rows themselves; each needs its own `key`. */
  children: ReactNode
}) {
  const { t } = useTranslation()
  const [opened, setOpened] = useSessionState(expandedKey, false)
  const collapsed = !opened
  const name = ownerName(owner, t('library.shared'))
  const toggleLabel = collapsed
    ? t('sync.expandOwner', { name })
    : t('sync.collapseOwner', { name })
  const toggle = () => setOpened((value) => !value)

  return (
    <section
      className={cn(
        'border-border ease-warm bg-surface flex min-w-0 flex-col overflow-hidden border transition-[border-color,translate] duration-150',
        collapsed && 'hover:border-border-strong hover:-translate-y-px',
      )}
    >
      {/* The card's strip: the tinted caption band while the group is open, the card itself while
          it is folded — the make of a Hub source, one level in. */}
      <div
        className={cn(
          'ease-warm flex min-w-0 flex-col gap-3 px-3 py-2.5 transition-colors duration-150 sm:flex-row sm:items-center sm:justify-between',
          !collapsed && 'bg-surface-2',
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <Tooltip content={toggleLabel}>
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
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
            className="focus-visible:outline-ring flex min-w-0 flex-1 items-center rounded-lg px-1 py-0.5 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <SectionHeader
              leading={<AgentIcon name={name} icon={owner.icon} ownerId={owner.id} size="sm" />}
              title={name}
              count={count}
            >
              {pending ? (
                <Badge tone="warning">{t('sync.pending', { count: pending })}</Badge>
              ) : null}
              {changed ? (
                <Badge tone="accent">{t('sync.changed', { count: changed })}</Badge>
              ) : null}
            </SectionHeader>
          </button>
        </div>

        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>

      <Reveal open={!collapsed}>
        {/* The rows keep the page canvas, exactly as a source's entries do — the card is the frame,
            its strip the band above them. They are a concentric run of their own (`.ah-card-group`,
            rendered by `AnimatedList`): a `--group-gap` apart, with only the corners at the exposed
            ends keeping the full radius — the same treatment the agent list uses. */}
        <div className="border-border bg-background flex flex-col gap-2 border-t px-3 pt-3 pb-3">
          <AnimatedList as="ul">{children}</AnimatedList>
        </div>
      </Reveal>
    </section>
  )
}
