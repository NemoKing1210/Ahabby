import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react'

import type { AgentRef } from '@/shared/bindings/AgentRef'
import { cn } from '@/shared/lib/cn'
import { shortenPath } from '@/shared/lib/format'
import { AgentIcon } from '@/shared/ui/AgentIcon'
import { AgentTag } from '@/shared/ui/AgentTag'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Reveal } from '@/shared/ui/Reveal'
import { SectionHeader } from '@/shared/ui/SectionHeader'
import { Timestamp } from '@/shared/ui/Timestamp'
import { Tooltip } from '@/shared/ui/Tooltip'

import type { LibraryGroupFacts } from '../facts'
import { LibraryGroupContextMenu } from './LibraryGroupContextMenu'

/**
 * One group of a library tab, wearing the card a Hub source wears: the strip on top, the cards on
 * the canvas it frames.
 *
 * The strip is the fold control *and* the group's own account of itself: the brand tile (or the
 * tab's icon), the title, how many it holds, its owners — and, under them, what the group is —
 * where it lives, what is switched off or unverified, the newest date among its files. All of that
 * is what a folded list is read for, so none of it hides behind the fold.
 *
 * The right-click menu belongs to the strip, never to the cards under it: a skill or a server
 * keeps its own menu.
 */
export function LibraryGroupCard({
  title,
  owner,
  owners,
  icon: Icon,
  count,
  facts,
  collapsed,
  onToggle,
  children,
}: {
  /** The title as the list knows it — already translated, so the shared surface reads in the UI's language. */
  title: string
  /** The group's owner, when the list is grouped by owner: its brand tile heads the strip. */
  owner?: AgentRef
  /** Owners of a name group, shown as tags at the far end of the strip. */
  owners?: AgentRef[]
  /** The tab's own icon, worn by a group that belongs to no single agent. */
  icon: LucideIcon
  /** Omitted when the number is meaningless for this group. */
  count?: number
  /** What the group says about itself, under its title. */
  facts: LibraryGroupFacts
  collapsed: boolean
  onToggle: () => void
  /** The cards of the group, mounted only while it is open. */
  children: ReactNode
}) {
  const { t } = useTranslation()
  const label = collapsed
    ? t('library.expandGroup', { name: title })
    : t('library.collapseGroup', { name: title })

  return (
    <section
      className={cn(
        'border-border ease-warm bg-surface flex min-w-0 flex-col overflow-hidden border transition-[border-color,translate] duration-150',
        collapsed && 'hover:border-border-strong hover:-translate-y-px',
      )}
    >
      <LibraryGroupContextMenu
        title={title}
        collapsed={collapsed}
        locations={facts.locations}
        onToggleCollapsed={onToggle}
      >
        <div
          className={cn(
            'ease-warm flex min-w-0 flex-col gap-2 px-3 py-2.5 transition-colors duration-150',
            // The band is the open state and nothing else: folded away the strip *is* the card.
            !collapsed && 'bg-surface-2',
          )}
        >
          <div className="flex min-w-0 items-center gap-1">
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
              <SectionHeader
                className="w-full"
                leading={
                  owner ? (
                    <AgentIcon name={owner.name} icon={owner.icon} ownerId={owner.id} size="sm" />
                  ) : (
                    // The tab's tile in the make of the Hub's header tiles: on the tinted band the
                    // plain `SectionHeader` tile would paint `surface-2` on `surface-2`.
                    <span
                      aria-hidden
                      className="border-border bg-surface text-muted inline-flex size-8 shrink-0 items-center justify-center rounded-lg border"
                    >
                      <Icon className="size-4" />
                    </span>
                  )
                }
                title={title}
                count={count}
              >
                {/* The owners are the group's far end: pushed to the edge of the strip, the title
                    and its count stay in the same column down the whole list. */}
                {owners && owners.length > 0 ? (
                  <span className="ml-auto flex flex-wrap items-center gap-2">
                    {owners.map((agent) => (
                      <AgentTag key={agent.id} agent={agent} />
                    ))}
                  </span>
                ) : null}
              </SectionHeader>
            </button>
          </div>
          <GroupFacts facts={facts} />
        </div>
      </LibraryGroupContextMenu>

      <Reveal open={!collapsed}>
        {/* The body keeps the page's own canvas, so the cards inside look exactly as they do
            anywhere else — the card is the frame around them, its strip the band above. */}
        <div className="border-border bg-background flex flex-col gap-2 border-t px-3 pt-3 pb-3">
          {children}
        </div>
      </Reveal>
    </section>
  )
}

/**
 * The line of facts under a group's title: where it lives, what is switched off or unverified, the
 * transport kinds of a servers group, and the newest date among its files.
 *
 * Each is shown only when it is true of this group — a group that is switched on and verified says
 * nothing about either — so the line never turns into a row of zeroes.
 */
function GroupFacts({ facts }: { facts: LibraryGroupFacts }) {
  const { t } = useTranslation()

  return (
    <div className="text-faint flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[0.75rem]">
      {facts.transports.map((type) => (
        <Badge key={type} tone="neutral">
          {type}
        </Badge>
      ))}
      {/* One string per badge, the count included: "Off 1" is one thing to read out loud, and a
          badge is not a filter — nothing about it is pressed or pressed out. */}
      {facts.unverified > 0 ? (
        <Badge tone="warning">{`${t('agents.unverified')} ${facts.unverified}`}</Badge>
      ) : null}
      {facts.off > 0 ? <Badge tone="neutral">{`${t('activity.off')} ${facts.off}`}</Badge> : null}
      {facts.locations.map((location) => (
        <code key={location} className="font-mono">
          {shortenPath(location)}
        </code>
      ))}
      <Timestamp createdMs={null} modifiedMs={facts.modifiedMs} />
    </div>
  )
}
