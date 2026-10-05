import { TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { CatalogProblem } from '@/shared/bindings/CatalogProblem'
import { cn } from '@/shared/lib/cn'

import { Card, CardContent, CardHeader, CardTitle } from './Card'

/**
 * Manifests that failed to load. Shown instead of silently hiding an agent, on every screen
 * that lists scanned data.
 */
export function CatalogProblems({
  problems,
  className,
}: {
  problems: CatalogProblem[]
  className?: string
}) {
  const { t } = useTranslation()
  const failures = problems.filter((problem) => problem.severity === 'error')
  if (failures.length === 0) return null

  return (
    <Card className={cn('border-warning/40', className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[0.9375rem]">
          <TriangleAlert className="text-warning-fg size-4" aria-hidden />
          {t('agents.problems')}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-muted text-[0.8125rem]">{t('agents.problemsHint')}</p>
        <ul className="text-muted flex flex-col gap-1 font-mono text-[0.75rem]">
          {failures.map((problem, index) => (
            <li key={`${problem.source}-${index}`} className="break-all">
              {problem.manifestId ? `${problem.manifestId}: ` : ''}
              {problem.message}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
