import { useTranslation } from 'react-i18next'
import { CheckSquare, Download, Square } from 'lucide-react'

import { Button } from '@/shared/ui/Button'

/**
 * The two quick actions for a set of skills: put them all in the selection, or open the batch
 * install dialog for the whole set. Used on a plugin group and on a flat skill list alike.
 */
export function HubBatchActions({
  selectable,
  selectedCount,
  onSelectAll,
  onInstallAll,
  installingAll,
  /** When true, Install stays available even if nothing installable is on screen yet (a group fetch). */
  allowEmptyInstall = false,
  selectLabel,
  deselectLabel,
  installLabel,
}: {
  selectable: number
  selectedCount: number
  onSelectAll: () => void
  onInstallAll: () => void
  installingAll?: boolean
  allowEmptyInstall?: boolean
  /** Override the select button label (group vs section wording). */
  selectLabel?: string
  deselectLabel?: string
  installLabel?: string
}) {
  const { t } = useTranslation()
  if (selectable <= 0 && !installingAll && !allowEmptyInstall) return null

  const allSelected = selectable > 0 && selectedCount >= selectable
  const SelectIcon = allSelected ? Square : CheckSquare

  return (
    <div className="flex flex-wrap items-center gap-2">
      {selectable > 0 ? (
        <Button variant="secondary" size="sm" aria-pressed={allSelected} onClick={onSelectAll}>
          <SelectIcon className="size-3.5" aria-hidden />
          {allSelected
            ? (deselectLabel ?? t('hub.deselectAll', { count: selectable }))
            : (selectLabel ?? t('hub.selectAll', { count: selectable }))}
        </Button>
      ) : null}
      <Button
        variant="primary"
        size="sm"
        loading={installingAll}
        disabled={selectable === 0 && !allowEmptyInstall && !installingAll}
        onClick={onInstallAll}
      >
        <Download className="size-3.5" aria-hidden />
        {installLabel ?? t('hub.installAll', { count: selectable })}
      </Button>
    </div>
  )
}
