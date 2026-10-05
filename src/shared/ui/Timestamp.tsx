import { useTranslation } from 'react-i18next'

import { formatDate, formatDateTime } from '@/shared/lib/format'

/**
 * One file date, labelled by what the platform actually reported.
 *
 * The creation time is preferred, but many Linux filesystems have none, so the modification
 * time stands in — with its own label, never mislabelled as "created". The exact date and
 * time live in the tooltip, which keeps the visible text short enough for a card row.
 */
export function Timestamp({
  createdMs,
  modifiedMs,
  className,
}: {
  createdMs?: number | null
  modifiedMs?: number | null
  className?: string
}) {
  const { t, i18n } = useTranslation()
  const created = createdMs ?? null
  const value = created ?? modifiedMs ?? null
  const date = formatDate(value, i18n.language)
  if (value === null || date === null) return null

  return (
    <span title={formatDateTime(value, i18n.language) ?? undefined} className={className}>
      {created !== null ? t('library.created') : t('library.modified')} {date}
    </span>
  )
}
