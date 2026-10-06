import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText } from 'lucide-react'

import type { ConfigFile } from '@/shared/bindings/ConfigFile'
import type { Project } from '@/shared/bindings/Project'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { PathRow } from '@/shared/ui/PathRow'

import { DocumentEditorDialog } from '@/features/editor/components/DocumentEditorDialog'
import { configDocument, type EditorDocument } from '@/features/editor/model'

/**
 * The project's addressable files (`AGENTS.md`, `.mcp.json`, settings…) in the same editor the
 * agent pages use. A file the scan did not find is offered as "Create"; opening it still goes
 * through the backend, which takes the backup and refuses a read-only file.
 */
export function ProjectFiles({ project }: { project: Project }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState<EditorDocument | null>(null)

  if (project.configs.length === 0) {
    return <p className="text-muted text-[0.8125rem]">{t('projects.filesEmpty')}</p>
  }

  return (
    <>
      <AnimatedList>
        {project.configs.map((config: ConfigFile) => (
          <Card key={config.id} className="flex items-center gap-4 p-4">
            <span
              aria-hidden
              className="border-border bg-surface-2 text-accent-strong inline-flex size-10 shrink-0 items-center justify-center rounded-lg border"
            >
              <FileText className="size-4" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-foreground font-serif text-[0.9375rem]">{config.label}</span>
                <Badge tone="outline">{config.format}</Badge>
                {!config.exists ? <Badge tone="accent">{t('configs.missing')}</Badge> : null}
              </div>
              <PathRow path={config.path} />
            </div>
            <Button
              variant={config.exists ? 'secondary' : 'primary'}
              size="sm"
              onClick={() => setOpen(configDocument(config))}
            >
              {config.exists ? t('configs.edit') : t('configs.create')}
            </Button>
          </Card>
        ))}
      </AnimatedList>

      {open ? (
        <DocumentEditorDialog
          key={open.path}
          agentId={project.id}
          document={open}
          onOpenChange={() => setOpen(null)}
        />
      ) : null}
    </>
  )
}
