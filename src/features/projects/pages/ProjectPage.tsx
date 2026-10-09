import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { ChevronLeft, FolderGit2, FolderOpen, Terminal as TerminalIcon } from 'lucide-react'

import { projectOwner } from '@/shared/lib/owners'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { EmptyState, ErrorState } from '@/shared/ui/EmptyState'
import { PageHeader } from '@/shared/ui/PageHeader'
import { PathRow } from '@/shared/ui/PathRow'
import { SkeletonList } from '@/shared/ui/Primitives'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/Tabs'
import { toastAppError } from '@/shared/ui/Toast'

import { useRevealPath } from '@/features/agents/api/queries'
import { OtherTab } from '@/features/agents/components/OtherTab'
import { ConfigsTab } from '@/features/configs/components/ConfigsTab'
import { McpTab } from '@/features/mcp/components/McpTab'
import { SkillsTab } from '@/features/skills/components/SkillsTab'

import { useProjects } from '../api/queries'
import { RunInProjectDialog } from '../components/RunInProjectDialog'

/** Small count next to a tab label; nothing is shown for an empty list. */
function TabCount({ value }: { value: number }) {
  if (value === 0) return null
  return <span className="text-faint ml-1.5">{value}</span>
}

/**
 * One project: its own skills, MCP servers, files and documents, read from the project
 * directory and edited through the same dialogs as an agent — the backend routes the writes by
 * the `project:<hash>` id. "Run agent here" starts a terminal in the project root.
 */
export function ProjectPage() {
  const { t } = useTranslation()
  const { projectId } = useParams()
  const { data, isLoading, error, refetch } = useProjects()
  const reveal = useRevealPath()
  const [runOpen, setRunOpen] = useState(false)

  if (isLoading && !data) return <SkeletonList />

  if (error && !data) return <ErrorState error={error} onRetry={() => void refetch()} />

  const project = data?.projects.find((candidate) => candidate.id === projectId)

  if (!project) {
    return (
      <EmptyState
        icon={FolderGit2}
        title={t('projects.notFound')}
        action={
          <Button asChild variant="secondary">
            <Link to="/projects">{t('projects.back')}</Link>
          </Button>
        }
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
              <Link to="/projects">
                <ChevronLeft className="size-3.5" aria-hidden />
                {t('projects.back')}
              </Link>
            </Button>
            <h1 className="text-2xl">{project.name}</h1>
            <PathRow path={project.root} className="max-w-xl" />
            <p className="text-faint flex flex-wrap items-center gap-x-3 text-[0.75rem]">
              <span>{t('agents.card.skills', { count: project.skills.length })}</span>
              <span>{t('agents.card.mcp', { count: project.mcpServers.length })}</span>
              <span>{t('agents.card.other', { count: project.other.length })}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setRunOpen(true)}>
              <TerminalIcon className="size-3.5" aria-hidden />
              {t('projects.runHere')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => reveal.mutate(project.root, { onError: toastAppError })}
            >
              <FolderOpen className="size-3.5" aria-hidden />
              {t('projects.reveal')}
            </Button>
          </div>
        </div>
      </PageHeader>

      {project.warnings.length > 0 ? (
        <Card className="border-warning/40 flex flex-col gap-2 p-4">
          <p className="text-foreground text-sm font-medium">{t('projects.warnings')}</p>
          <AnimatedList
            as="ul"
            grouped={false}
            className="text-muted list-disc pl-5 text-[0.8125rem]"
          >
            {project.warnings.map((warning) => (
              <div key={warning}>{warning}</div>
            ))}
          </AnimatedList>
        </Card>
      ) : null}

      <Tabs defaultValue="skills" className="flex flex-col">
        <TabsList className="self-start">
          <TabsTrigger value="skills">
            {t('agent.tabs.skills')}
            <TabCount value={project.skills.length} />
          </TabsTrigger>
          <TabsTrigger value="mcp">
            {t('agent.tabs.mcp')}
            <TabCount value={project.mcpServers.length} />
          </TabsTrigger>
          <TabsTrigger value="files">
            {t('projects.files')}
            <TabCount value={project.configs.length} />
          </TabsTrigger>
          <TabsTrigger value="other">
            {t('agent.tabs.other')}
            <TabCount value={project.other.length} />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="skills">
          <SkillsTab agentId={project.id} skills={project.skills} owner={projectOwner(project)} />
        </TabsContent>

        <TabsContent value="mcp">
          <McpTab
            agentId={project.id}
            servers={project.mcpServers}
            configs={project.configs}
            owner={projectOwner(project)}
          />
        </TabsContent>

        <TabsContent value="files">
          <ConfigsTab
            agentId={project.id}
            configs={project.configs}
            emptyHint={t('projects.filesEmpty')}
          />
        </TabsContent>

        <TabsContent value="other">
          <OtherTab resources={project.other} />
        </TabsContent>
      </Tabs>

      {runOpen ? <RunInProjectDialog project={project} onClose={() => setRunOpen(false)} /> : null}
    </div>
  )
}
