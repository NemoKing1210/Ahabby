import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bot,
  Brain,
  ChevronDown,
  ChevronRight,
  FileText,
  FolderTree,
  MessageSquare,
  Pencil,
  Plus,
  Scale,
  Terminal,
  Webhook,
  type LucideIcon,
} from 'lucide-react'

import type { OtherKind } from '@/shared/bindings/OtherKind'
import type { OtherResource } from '@/shared/bindings/OtherResource'
import { cn } from '@/shared/lib/cn'
import { formatBytes } from '@/shared/lib/format'
import { AgentTag } from '@/shared/ui/AgentTag'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { CodeViewer } from '@/shared/ui/CodeViewer'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Markdown } from '@/shared/ui/Markdown'
import { PathRow } from '@/shared/ui/PathRow'
import { Reveal } from '@/shared/ui/Reveal'
import { SectionHeader } from '@/shared/ui/SectionHeader'
import { Timestamp } from '@/shared/ui/Timestamp'

import { DocumentEditorDialog } from '@/features/editor/components/DocumentEditorDialog'

import { OtherResourceContextMenu } from './OtherResourceContextMenu'

/** Display order of the kinds, shared with the Library toolbar's kind filter. */
export const OTHER_KIND_ORDER: OtherKind[] = [
  'instructions',
  'memory',
  'rules',
  'commands',
  'subagents',
  'hooks',
  'prompts',
]

const KIND_ICONS: Record<OtherKind, LucideIcon> = {
  instructions: FileText,
  memory: Brain,
  rules: Scale,
  commands: Terminal,
  subagents: Bot,
  hooks: Webhook,
  prompts: MessageSquare,
}

function ResourceCard({
  resource,
  showAgent,
  onEdit,
}: {
  resource: OtherResource
  /** Names the owning agent — only useful where several agents share the list. */
  showAgent?: boolean
  onEdit?: (resource: OtherResource) => void
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const content = resource.content
  const missing = !resource.exists
  const hasBody = resource.exists && (content !== undefined || resource.isDirectory)
  const body = !content ? null : resource.format === 'markdown' ? (
    <Markdown source={content} />
  ) : (
    <CodeViewer value={content} format={resource.format} height="40vh" />
  )

  return (
    <OtherResourceContextMenu
      resource={resource}
      expanded={expanded}
      hasBody={hasBody}
      onToggleExpanded={() => setExpanded((value) => !value)}
      onEdit={onEdit}
    >
      <Card
        className={cn(
          'ease-warm hover:border-border-strong flex flex-col gap-3 p-4 transition-[border-color] duration-150',
          missing && 'border-border-strong bg-surface-2/40 border-dashed',
        )}
      >
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
            {showAgent ? <AgentTag agent={resource.agent} /> : null}
            {resource.isDirectory ? (
              <Badge tone="outline">
                <FolderTree className="size-3" aria-hidden />
                {resource.itemCount ?? 0}
              </Badge>
            ) : null}
            {missing ? <Badge tone="accent">{t('configs.missing')}</Badge> : null}
            {resource.unverified ? <Badge tone="warning">{t('agents.unverified')}</Badge> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {onEdit && !resource.isDirectory ? (
              <Button
                variant={missing ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => onEdit(resource)}
              >
                {missing ? (
                  <Plus className="size-3.5" aria-hidden />
                ) : (
                  <Pencil className="size-3.5" aria-hidden />
                )}
                {missing ? t('configs.create') : t('configs.edit')}
              </Button>
            ) : null}
            <Timestamp
              createdMs={resource.createdMs}
              modifiedMs={resource.modifiedMs}
              className="text-faint text-[0.6875rem]"
            />
            <span className="text-faint text-[0.6875rem]">
              {formatBytes(resource.sizeBytes) ?? ''}
            </span>
          </div>
        </div>

        {resource.description ? (
          <p className="text-muted max-w-prose text-[0.75rem]">{resource.description}</p>
        ) : null}

        <PathRow path={resource.path} />

        <Reveal open={expanded && body !== null}>{body}</Reveal>
      </Card>
    </OtherResourceContextMenu>
  )
}

/** Instructions, commands, sub-agents, hooks and rules — grouped by kind. */
export function OtherTab({
  resources,
  showAgent,
}: {
  resources: OtherResource[]
  /** Set from the library, where the list spans every agent. */
  showAgent?: boolean
}) {
  const { t } = useTranslation()
  const [editTarget, setEditTarget] = useState<OtherResource | null>(null)

  if (resources.length === 0) {
    return <EmptyState title={t('library.empty')} hint={t('library.emptyHint')} />
  }

  // Inside a group, files that do not exist yet come last — same rule as the configs list.
  const groups = OTHER_KIND_ORDER.map((kind) => {
    const items = resources.filter((resource) => resource.kind === kind)
    return {
      kind,
      items: [
        ...items.filter((resource) => resource.exists),
        ...items.filter((resource) => !resource.exists),
      ],
    }
  }).filter((group) => group.items.length > 0)

  return (
    <>
      <div className="flex flex-col gap-6">
        {groups.map((group) => (
          <section key={group.kind} className="flex flex-col gap-3">
            <SectionHeader
              icon={KIND_ICONS[group.kind]}
              title={t(`library.kind.${group.kind}`)}
              count={group.items.length}
            />
            <AnimatedList>
              {group.items.map((resource) => (
                <ResourceCard
                  key={resource.id}
                  resource={resource}
                  showAgent={showAgent}
                  onEdit={setEditTarget}
                />
              ))}
            </AnimatedList>
          </section>
        ))}
      </div>

      {editTarget ? (
        <DocumentEditorDialog
          key={editTarget.path}
          agentId={editTarget.agent.id}
          document={{
            path: editTarget.path,
            label: editTarget.label,
            format: editTarget.format,
            editable: true,
            description: editTarget.description,
          }}
          onOpenChange={() => setEditTarget(null)}
        />
      ) : null}
    </>
  )
}
