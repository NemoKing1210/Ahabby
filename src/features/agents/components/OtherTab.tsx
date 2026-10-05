import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, FolderTree } from 'lucide-react'

import type { OtherKind } from '@/shared/bindings/OtherKind'
import type { OtherResource } from '@/shared/bindings/OtherResource'
import { formatBytes } from '@/shared/lib/format'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Badge } from '@/shared/ui/Badge'
import { Card } from '@/shared/ui/Card'
import { CodeViewer } from '@/shared/ui/CodeViewer'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Markdown } from '@/shared/ui/Markdown'
import { PathRow } from '@/shared/ui/PathRow'
import { Reveal } from '@/shared/ui/Reveal'

const KIND_ORDER: OtherKind[] = [
  'instructions',
  'memory',
  'rules',
  'commands',
  'subagents',
  'hooks',
  'prompts',
]

function ResourceCard({ resource }: { resource: OtherResource }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const content = resource.content
  const hasBody = resource.exists && (content !== undefined || resource.isDirectory)
  const body = !content ? null : resource.format === 'markdown' ? (
    <Markdown source={content} />
  ) : (
    <CodeViewer value={content} format={resource.format} height="40vh" />
  )

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="text-foreground hover:text-accent-strong flex items-center gap-1.5 text-sm"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            disabled={!hasBody}
          >
            {hasBody ? (
              expanded ? (
                <ChevronDown className="size-3.5" aria-hidden />
              ) : (
                <ChevronRight className="size-3.5" aria-hidden />
              )
            ) : null}
            {resource.label}
          </button>
          {resource.isDirectory ? (
            <Badge tone="outline">
              <FolderTree className="size-3" aria-hidden />
              {resource.itemCount ?? 0}
            </Badge>
          ) : null}
          {!resource.exists ? <Badge tone="neutral">{t('configs.missing')}</Badge> : null}
          {resource.unverified ? <Badge tone="warning">{t('agents.unverified')}</Badge> : null}
        </div>
        <span className="text-faint text-[11px]">{formatBytes(resource.sizeBytes) ?? ''}</span>
      </div>

      {resource.description ? (
        <p className="text-muted max-w-prose text-[12px]">{resource.description}</p>
      ) : null}

      <PathRow path={resource.path} />

      <Reveal open={expanded && body !== null}>{body}</Reveal>
    </Card>
  )
}

/** Instructions, commands, sub-agents, hooks and rules — grouped by kind. */
export function OtherTab({ resources }: { resources: OtherResource[] }) {
  const { t } = useTranslation()

  if (resources.length === 0) {
    return <EmptyState title={t('library.empty')} hint={t('library.emptyHint')} />
  }

  const groups = KIND_ORDER.map((kind) => ({
    kind,
    items: resources.filter((resource) => resource.kind === kind),
  })).filter((group) => group.items.length > 0)

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <section key={group.kind} className="flex flex-col gap-3">
          <h3 className="flex items-center gap-2 text-[15px]">
            {t(`library.kind.${group.kind}`)}
            <Badge tone="neutral">{group.items.length}</Badge>
          </h3>
          <AnimatedList className="flex flex-col gap-3">
            {group.items.map((resource) => (
              <ResourceCard key={resource.id} resource={resource} />
            ))}
          </AnimatedList>
        </section>
      ))}
    </div>
  )
}
