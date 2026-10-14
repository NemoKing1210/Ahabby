import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, FolderOpen } from 'lucide-react'

import { cn } from '@/shared/lib/cn'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Tooltip } from '@/shared/ui/Tooltip'

import { formatGroupTitle } from '../lib/grouping'
import { HubBatchActions } from './HubBatchActions'

/**
 * Heading above one plugin's skills: the human title, how many are in view, a fold control, and
 * the two quick actions — select every skill of the group on screen, or install the whole group.
 *
 * Batch actions stay visible while the group is folded: installing or selecting does not need the
 * cards open.
 *
 * It is the *strip* of the group's card, not a card of its own — the bordered surface around it
 * belongs to `HubGroupBlock`, which is what lets a group weld to its neighbours the way a source
 * does. Open, the strip is the tinted caption band its skills hang under; folded, it is the card.
 */
export function HubGroupHeader({
  groupId,
  count,
  selectable,
  selectedCount,
  collapsed,
  onToggleCollapsed,
  onSelectAll,
  onInstallAll,
  installingAll,
}: {
  groupId: string
  /** Skills of this group currently on screen. */
  count: number
  /** How many of them can be selected for a batch install. */
  selectable: number
  /** How many of those are already in the page selection. */
  selectedCount: number
  collapsed: boolean
  onToggleCollapsed: () => void
  onSelectAll: () => void
  onInstallAll: () => void
  installingAll?: boolean
}) {
  const { t } = useTranslation()
  const title = formatGroupTitle(groupId)
  const toggleLabel = collapsed
    ? t('hub.expandGroup', { name: title })
    : t('hub.collapseGroup', { name: title })

  return (
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
            onClick={onToggleCollapsed}
          >
            {collapsed ? (
              <ChevronRight className="size-3.5" aria-hidden />
            ) : (
              <ChevronDown className="size-3.5" aria-hidden />
            )}
          </Button>
        </Tooltip>
        <span
          aria-hidden
          className="border-border bg-surface text-muted inline-flex size-8 shrink-0 items-center justify-center rounded-lg border"
        >
          <FolderOpen className="size-4" />
        </span>
        <button
          type="button"
          className="focus-visible:outline-ring flex min-w-0 flex-col gap-0.5 rounded-md text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
          aria-expanded={!collapsed}
          onClick={onToggleCollapsed}
        >
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-foreground text-[0.9375rem] font-medium">{title}</h3>
            <Badge tone="neutral">{count}</Badge>
          </div>
          <p className="text-faint text-[0.75rem]">{t('hub.groupHint', { group: groupId })}</p>
        </button>
      </div>

      <HubBatchActions
        selectable={selectable}
        selectedCount={selectedCount}
        onSelectAll={onSelectAll}
        onInstallAll={onInstallAll}
        installingAll={installingAll}
        allowEmptyInstall
        selectLabel={t('hub.selectGroupAll', { count: selectable })}
        deselectLabel={t('hub.deselectGroupAll', { count: selectable })}
        installLabel={t('hub.installGroupAll')}
      />
    </div>
  )
}
