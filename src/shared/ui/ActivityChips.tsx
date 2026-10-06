import { useTranslation } from 'react-i18next'

import { ACTIVITY_FILTERS, activityCounts, type ActivityFilter } from '@/shared/lib/activity'
import { Chip } from '@/shared/ui/Chip'

const LABEL_KEYS: Record<ActivityFilter, string> = {
  all: 'common.all',
  on: 'activity.on',
  off: 'activity.off',
}

/**
 * The activity chip row — "All / On / Off" with the number of resources behind each choice.
 *
 * Every list that carries switches gets one, so a switched-off skill or server can be found
 * without reading the whole list. The counts are what keep it honest: "Off 0" says there is
 * nothing to find instead of looking like a filter that does nothing.
 */
export function ActivityChips({
  items,
  value,
  onChange,
}: {
  /** The resources the row counts and narrows; each one carries its own `enabled` flag. */
  items: readonly { enabled: boolean }[]
  value: ActivityFilter
  onChange: (filter: ActivityFilter) => void
}) {
  const { t } = useTranslation()
  const counts = activityCounts(items)

  return (
    <div
      role="group"
      aria-label={t('activity.label')}
      className="flex flex-wrap items-center gap-1.5"
    >
      <span className="text-faint text-[0.6875rem] tracking-wide uppercase">
        {t('activity.label')}
      </span>
      {ACTIVITY_FILTERS.map((option) => (
        <Chip
          key={option}
          label={t(LABEL_KEYS[option])}
          count={counts[option]}
          active={value === option}
          onClick={() => onChange(option)}
        />
      ))}
    </div>
  )
}
