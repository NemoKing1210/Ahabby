import { useQueryClient } from '@tanstack/react-query'
import type { LucideIcon } from 'lucide-react'
import {
  BookOpen,
  Bot,
  Boxes,
  Bug,
  Cloud,
  Code2,
  Database,
  Layers,
  Layout,
  Shield,
  Smartphone,
  Sparkles,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { queryKeys } from '@/shared/api/keys'
import type { HubEntry } from '@/shared/bindings/HubEntry'
import type { HubSource } from '@/shared/bindings/HubSource'
import { cn } from '@/shared/lib/cn'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { EmptyState } from '@/shared/ui/EmptyState'
import { SkeletonList } from '@/shared/ui/Primitives'

import {
  RECOMMENDATION_ROLES,
  roleById,
  type RecommendationRoleId,
} from '../recommendations/catalog'
import { useRecommendations } from '../recommendations/useRecommendations'
import { isBatchable } from '../lib/grouping'
import { HubEntryCard } from './HubEntryCard'

const ROLE_ICONS: Record<RecommendationRoleId, LucideIcon> = {
  everyday: Sparkles,
  frontend: Layout,
  backend: Code2,
  fullstack: Layers,
  mobile: Smartphone,
  devops: Cloud,
  security: Shield,
  qa: Bug,
  data: Database,
  docs: BookOpen,
  agents: Bot,
}

/**
 * Role-based skill picks: pick what you do, then install the shortlist through the same dialogs
 * the catalogue uses.
 */
export function HubRecommendations({
  roleId,
  onRoleChange,
  sources,
  onView,
  onInstall,
  onRefresh,
  onBatchInstall,
  refreshingId,
  selectedIds,
  onToggleSelect,
}: {
  roleId: RecommendationRoleId
  onRoleChange: (role: RecommendationRoleId) => void
  sources: HubSource[]
  onView: (entry: HubEntry) => void
  onInstall: (entry: HubEntry) => void
  onRefresh: (entry: HubEntry) => void
  onBatchInstall: (entries: HubEntry[]) => void
  refreshingId: string | null
  selectedIds: Set<string>
  onToggleSelect: (entry: HubEntry) => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const role = roleById(roleId)
  const { items, pending, missing } = useRecommendations(role.picks)
  const sourceById = new Map(sources.map((source) => [source.id, source]))

  const installMissing = () => {
    const batchable = missing.filter(isBatchable)
    if (batchable.length === 0) return
    onBatchInstall(batchable)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex max-w-2xl flex-col gap-1">
            <h2 className="text-[0.9375rem] font-medium">{t('hub.recommendations.title')}</h2>
            <p className="text-muted text-[0.8125rem]">{t('hub.recommendations.subtitle')}</p>
          </div>
          {missing.length > 0 ? (
            <Button size="sm" onClick={installMissing}>
              {t('hub.recommendations.installMissing', { count: missing.length })}
            </Button>
          ) : null}
        </div>

        <div
          role="listbox"
          aria-label={t('hub.recommendations.rolesLabel')}
          className="flex flex-wrap gap-2"
        >
          {RECOMMENDATION_ROLES.map((candidate) => {
            const Icon = ROLE_ICONS[candidate.id]
            const selected = candidate.id === roleId
            return (
              <button
                key={candidate.id}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => onRoleChange(candidate.id)}
                className={cn(
                  'border-border inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-[0.8125rem] transition-[background,border-color,color,box-shadow] duration-150',
                  'outline-ring focus-visible:outline-2 focus-visible:outline-offset-2',
                  selected
                    ? 'border-accent text-accent-strong bg-[color-mix(in_oklab,var(--color-accent)_14%,var(--color-surface))] shadow-sm'
                    : 'bg-surface-2 text-muted hover:border-border-strong hover:text-foreground',
                )}
              >
                <Icon className="size-3.5 shrink-0 opacity-80" aria-hidden />
                <span className="font-medium">
                  {t(`hub.recommendations.roles.${candidate.id}`)}
                </span>
              </button>
            )
          })}
        </div>

        <p className="text-muted text-[0.8125rem]">
          {t(`hub.recommendations.roleHints.${roleId}`)}
        </p>
      </div>

      {pending && items.every((item) => item.entry === null) ? (
        <SkeletonList rows={4} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title={t('hub.recommendations.empty')}
          hint={t('hub.recommendations.emptyHint')}
        />
      ) : (
        <AnimatedList grouped={false} className="flex flex-col gap-3">
          {items.map((item) => {
            const sourceId = item.entry?.sourceId ?? item.pick.entryId.split('/')[0] ?? ''
            const source = sourceById.get(sourceId)
            const why = t(`hub.recommendations.why.${item.pick.id}`)

            if (item.entry && source) {
              return (
                <div key={item.pick.id} className="flex flex-col gap-2">
                  <WhyLine text={why} installed={item.entry.installed.length > 0} />
                  <HubEntryCard
                    entry={item.entry}
                    source={source}
                    onView={onView}
                    onInstall={onInstall}
                    onRefresh={onRefresh}
                    refreshing={refreshingId === item.entry.id}
                    selected={selectedIds.has(item.entry.id)}
                    onToggleSelect={onToggleSelect}
                  />
                </div>
              )
            }

            return (
              <Card
                key={item.pick.id}
                className="border-border flex flex-col gap-2 border border-dashed p-4"
              >
                <WhyLine text={why} installed={false} />
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="truncate text-[0.875rem] font-medium">
                      {t(`hub.recommendations.picks.${item.pick.id}`)}
                    </p>
                    <p className="text-muted text-[0.75rem]">
                      {item.pending
                        ? t('hub.recommendations.loading')
                        : t('hub.recommendations.unavailable')}
                    </p>
                  </div>
                  {!item.pending ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        void client.invalidateQueries({
                          queryKey: queryKeys.hubEntry(item.pick.entryId),
                        })
                      }
                    >
                      {t('common.retry')}
                    </Button>
                  ) : null}
                </div>
              </Card>
            )
          })}
        </AnimatedList>
      )}
    </div>
  )
}

function WhyLine({ text, installed }: { text: string; installed: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center gap-2 px-0.5">
      <p className="text-muted text-[0.75rem] leading-snug">{text}</p>
      {installed ? (
        <Badge tone="success" dot="success">
          {t('hub.installedBadge')}
        </Badge>
      ) : null}
    </div>
  )
}
