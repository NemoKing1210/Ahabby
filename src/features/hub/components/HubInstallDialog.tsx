import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, TriangleAlert } from 'lucide-react'

import type { AgentRef } from '@/shared/bindings/AgentRef'
import type { HubEntryDetail } from '@/shared/bindings/HubEntryDetail'
import type { HubInstallRequest } from '@/shared/bindings/HubInstallRequest'
import type { McpDraftTransport } from '@/shared/bindings/McpDraftTransport'
import { ownerName, projectOwner, SHARED_OWNER } from '@/shared/lib/owners'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Chip } from '@/shared/ui/Chip'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { EmptyState, ErrorState } from '@/shared/ui/EmptyState'
import { FormField } from '@/shared/ui/FormField'
import { Input } from '@/shared/ui/Input'
import { OwnerSelect } from '@/shared/ui/OwnerSelect'
import { SkeletonList } from '@/shared/ui/Primitives'
import { Textarea } from '@/shared/ui/Textarea'
import { toast, toastAppError } from '@/shared/ui/Toast'
import { Tooltip } from '@/shared/ui/Tooltip'

import { useAgents, useFavoriteAgents } from '@/features/agents/api/queries'
import { orderByFavorite } from '@/features/agents/lib/favorites'
import { useProjects } from '@/features/projects/api/queries'

import { useInstallHubResource } from '../api/hooks'
import { useHubEntry } from '../api/queries'
import { HubEntryLinks, HubEntryMeta, HubFileList, HubInstalledList } from './HubEntryParts'

type Transport = 'stdio' | 'http'

/**
 * The directory name an install would derive from a skill's name — the same rule the backend uses
 * (`skill_slug`), so the warning below is about the write that would actually happen.
 */
function skillSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * One value written into the config of the chosen owner: an environment variable of a local
 * server, or a header of a remote one.
 *
 * `required` and `secret` come from the publisher's own declaration and stay with the row even
 * if the user renames the key — they describe the value, not the name.
 */
interface ValueRow {
  key: string
  value: string
  required: boolean
  secret: boolean
}

/**
 * Install one hub entry.
 *
 * The dialog is the review step the backend insists on: it names the collection the payload comes
 * from, lists every file it will write (saying which of them an agent may run) or the exact launch
 * recipe it will write instead, and only then offers a target. Nothing is fetched or written until
 * the user confirms, and `confirm: true` is sent only after that review — a UI that skipped it
 * would be refused by `install_hub_resource`.
 *
 * What the entry *is* lives in `HubEntryParts`, shared with the preview: this dialog is the form.
 */
export function HubInstallDialog({ entryId, onClose }: { entryId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const detail = useHubEntry(entryId)

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="w-[min(760px,94vw)]">
        {detail.isPending ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('hub.installTitle')}</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <SkeletonList rows={3} />
            </DialogBody>
          </>
        ) : detail.isError || !detail.data ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('hub.installTitle')}</DialogTitle>
              <DialogDescription>{t('hub.entryFailed')}</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
            </DialogBody>
          </>
        ) : (
          <InstallForm key={entryId} detail={detail.data} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function InstallForm({ detail, onClose }: { detail: HubEntryDetail; onClose: () => void }) {
  const { t } = useTranslation()
  const install = useInstallHubResource()
  const agents = useAgents()
  const favoriteIds = useFavoriteAgents()
  const projects = useProjects()
  const entry = detail.entry
  const source = detail.transport

  // Owners a payload can be written for: the agent-neutral shared surface first (the general
  // case, and what "install globally" means), then every installed agent — the pinned ones
  // first — and then every project the scan found. A resource written for an agent that is not
  // installed would not be scanned.
  const owners = useMemo<AgentRef[]>(
    () => [
      SHARED_OWNER,
      ...orderByFavorite(
        (agents.data?.agents ?? [])
          .filter((agent) => agent.status === 'installed')
          .map((agent) => ({ id: agent.id, name: agent.name, icon: agent.icon })),
        favoriteIds,
      ),
      ...(projects.data?.projects ?? []).map(projectOwner),
    ],
    [agents.data, projects.data, favoriteIds],
  )

  const [ownerId, setOwnerId] = useState(owners[0]?.id ?? '')
  const [name, setName] = useState(entry.name)
  const [transport, setTransport] = useState<Transport>(source?.type === 'http' ? 'http' : 'stdio')
  const [command, setCommand] = useState(source?.type === 'stdio' ? source.command : '')
  const [args, setArgs] = useState(source?.type === 'stdio' ? source.args.join('\n') : '')
  const [url, setUrl] = useState(source?.type === 'http' ? source.url : '')
  const [rows, setRows] = useState<ValueRow[]>(() =>
    detail.inputs.map((input) => ({
      key: input.key,
      value: input.default ?? '',
      required: input.required,
      secret: input.secret,
    })),
  )

  const scripts = detail.files.filter((file) => file.kind === 'script')
  const missing = rows.filter((row) => row.required && row.value.trim().length === 0)
  const named = name.trim()
  const isMcp = entry.kind === 'mcp'
  // A name the chosen owner already holds: a skill lands in the directory its name makes (the
  // backend refuses an existing one), and an MCP entry is keyed by the name it was given. Saying so
  // here is what keeps the user from walking into a refusal they could not have foreseen.
  const takenHere =
    entry.installed.some((install) => install.owner.id === ownerId) &&
    (isMcp ? named === entry.name.trim() : skillSlug(named) === skillSlug(entry.name))
  const valid =
    ownerId.length > 0 &&
    named.length > 0 &&
    !takenHere &&
    (!isMcp || (transport === 'stdio' ? command.trim().length > 0 : url.trim().length > 0)) &&
    missing.length === 0

  const values = rows
    .filter((row) => row.key.trim().length > 0)
    .map((row) => ({ key: row.key.trim(), value: row.value }))

  const submit = () => {
    if (!valid) return
    const argsPerLine = args
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    const draft: McpDraftTransport | null = !isMcp
      ? null
      : transport === 'stdio'
        ? { type: 'stdio', command: command.trim(), args: argsPerLine, env: values }
        : { type: 'http', url: url.trim(), headers: values }

    const request: HubInstallRequest = {
      ownerId,
      entryId: entry.id,
      name: named === entry.name ? null : named,
      transport: draft,
      // The user is looking at the list of files (or the recipe) above: this is that confirmation.
      confirm: true,
    }
    install.mutate(request, {
      onSuccess: (result) => {
        const written = result.data.skill ?? result.data.server
        toast.success(
          t('hub.installed', {
            name: written?.name ?? entry.name,
            owner: ownerName(result.data.owner, t('library.shared')),
          }),
        )
        onClose()
      },
      // A refused write keeps the dialog open: the message says what to fix.
      onError: (error) => toastAppError(error),
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2">
          {entry.title ?? entry.name}
          <Badge tone={entry.kind === 'skill' ? 'accent' : 'info'}>
            {t(`hub.kind.${entry.kind}`)}
          </Badge>
        </DialogTitle>
        <DialogDescription>{t('hub.installBody', { source: entry.sourceName })}</DialogDescription>
      </DialogHeader>

      <DialogBody className="flex flex-col gap-5">
        {entry.description ? (
          <p className="text-muted text-[0.8125rem] whitespace-pre-line">{entry.description}</p>
        ) : null}

        <HubEntryMeta entry={entry} />
        <HubInstalledList entry={entry} />

        {scripts.length > 0 ? (
          <div className="border-warning/40 bg-warning/5 flex items-start gap-2 rounded-lg border p-3">
            <TriangleAlert className="text-warning-fg mt-0.5 size-4 shrink-0" aria-hidden />
            <p className="text-[0.8125rem]">{t('hub.scriptsWarning')}</p>
          </div>
        ) : null}

        {/* What the install writes. A skill is a directory of files; a server is one recipe. */}
        {entry.kind === 'skill' ? (
          <FormField label={t('hub.writesFiles')} hint={t('hub.writesFilesHint')}>
            <HubFileList files={detail.files} />
          </FormField>
        ) : (
          <>
            <FormField label={t('hub.launch')} hint={t('hub.launchHint')}>
              <div className="flex flex-wrap gap-2">
                <Chip
                  label={t('mcp.transportStdio')}
                  active={transport === 'stdio'}
                  onClick={() => setTransport('stdio')}
                />
                <Chip
                  label={t('mcp.transportHttp')}
                  active={transport === 'http'}
                  onClick={() => setTransport('http')}
                />
              </div>
            </FormField>

            {transport === 'stdio' ? (
              <>
                <FormField label={t('mcp.createCommand')} htmlFor="hub-command">
                  <Input
                    id="hub-command"
                    value={command}
                    placeholder={t('mcp.createCommandPlaceholder')}
                    onChange={(event) => setCommand(event.target.value)}
                  />
                </FormField>
                <FormField label={t('mcp.createArgs')} htmlFor="hub-args" hint={t('hub.argsHint')}>
                  <Textarea
                    id="hub-args"
                    rows={3}
                    className="font-mono"
                    value={args}
                    onChange={(event) => setArgs(event.target.value)}
                  />
                </FormField>
              </>
            ) : (
              <FormField label={t('mcp.createUrl')} htmlFor="hub-url">
                <Input
                  id="hub-url"
                  value={url}
                  placeholder={t('mcp.createUrlPlaceholder')}
                  onChange={(event) => setUrl(event.target.value)}
                />
              </FormField>
            )}

            <FormField
              label={t(transport === 'stdio' ? 'mcp.createEnv' : 'mcp.createHeaders')}
              hint={t('hub.valuesHint')}
            >
              <div className="flex flex-col gap-2">
                {rows.map((row, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      aria-label={t('hub.valueKey')}
                      className="w-1/3 min-w-0 font-mono"
                      value={row.key}
                      onChange={(event) =>
                        setRows((current) =>
                          current.map((candidate, position) =>
                            position === index
                              ? { ...candidate, key: event.target.value }
                              : candidate,
                          ),
                        )
                      }
                    />
                    <Input
                      aria-label={t('hub.valueValue')}
                      className="min-w-0 flex-1 font-mono"
                      type={row.secret ? 'password' : 'text'}
                      value={row.value}
                      onChange={(event) =>
                        setRows((current) =>
                          current.map((candidate, position) =>
                            position === index
                              ? { ...candidate, value: event.target.value }
                              : candidate,
                          ),
                        )
                      }
                    />
                    {row.required ? (
                      <Tooltip content={t('hub.required')}>
                        <span className="text-warning-fg text-xs">*</span>
                      </Tooltip>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('hub.removeValue')}
                      onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
                <div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setRows((current) => [
                        ...current,
                        { key: '', value: '', required: false, secret: false },
                      ])
                    }
                  >
                    <Plus className="size-3.5" aria-hidden />
                    {t('hub.addValue')}
                  </Button>
                </div>
                {missing.length > 0 ? (
                  <p className="text-danger-fg text-[0.75rem]" role="alert">
                    {t('hub.missingValues', {
                      keys: missing.map((row) => row.key).join(', '),
                    })}
                  </p>
                ) : null}
                <ul className="text-faint flex flex-col gap-0.5 text-[0.75rem]">
                  {detail.inputs.map((input) =>
                    input.description ? (
                      <li key={input.key}>
                        <span className="font-mono">{input.key}</span> — {input.description}
                      </li>
                    ) : null,
                  )}
                </ul>
              </div>
            </FormField>
          </>
        )}

        <div className="border-border flex flex-col gap-4 border-t pt-4">
          <OwnerSelect
            label={t('hub.target')}
            hint={t('hub.targetHint')}
            owners={owners}
            value={ownerId}
            onChange={setOwnerId}
          />

          <FormField label={t('hub.name')} htmlFor="hub-install-name" hint={t('hub.nameHint')}>
            <Input
              id="hub-install-name"
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>

          {takenHere ? (
            <p className="text-warning-fg text-[0.75rem]" role="alert">
              {t('hub.installedConflict', { name: named })}
            </p>
          ) : null}

          <HubEntryLinks entry={entry} docs={detail.sourceUrl} />
        </div>

        {entry.installable ? null : (
          <EmptyState title={t('hub.notInstallable')} hint={entry.installProblem ?? undefined} />
        )}
      </DialogBody>

      <div className="border-border flex items-center justify-end gap-2 border-t px-6 py-4">
        <Button variant="ghost" onClick={onClose} disabled={install.isPending}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="primary"
          onClick={submit}
          disabled={!valid || !entry.installable}
          loading={install.isPending}
        >
          {t('hub.install')}
        </Button>
      </div>
    </>
  )
}
