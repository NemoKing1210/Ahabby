import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, ExternalLink, Eye, EyeOff, Pencil, Trash2, X } from 'lucide-react'

import type { Agent } from '@/shared/bindings/Agent'
import type { ConfigFact } from '@/shared/bindings/ConfigFact'
import type { ConfigFile } from '@/shared/bindings/ConfigFile'
import { copyText } from '@/shared/lib/clipboard'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { toast, toastAppError } from '@/shared/ui/Toast'
import { Tooltip } from '@/shared/ui/Tooltip'

import { useBrowser } from '@/features/browser/context'
import { useDocumentSnapshot } from '@/features/editor/api/hooks'
import { DocumentEditorDialog } from '@/features/editor/components/DocumentEditorDialog'
import { DiffView } from '@/features/editor/components/DiffView'
import { configDocument } from '@/features/editor/model'

import {
  usePreviewConfigFact,
  useRemoveConfigFact,
  useRevealConfigFact,
  useSaveConfigFact,
} from '../api/queries'

/**
 * "Quick settings": the few values a user wants at a glance, lifted out of the agent's own
 * config files during the scan — default model, provider, endpoints, proxy and credentials.
 *
 * A row is also editable in place: the pencil turns the value into an input and `Enter` writes
 * it through the same backend checks the full editor uses (validate, backup, atomic replace).
 * The write never goes through the frontend — it sends a dotted key and the new text, and Rust
 * patches the file on disk, so the rest of the document is byte-for-byte what it was.
 *
 * Credentials arrive already masked; showing a real one takes an explicit click that asks the
 * backend for that single value, exactly like an MCP secret does. Editing one never reveals the
 * old value — the input starts empty.
 */
export function AgentFactsCard({ agent }: { agent: Agent }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState<ConfigFile | null>(null)
  const [diff, setDiff] = useState<{ file: string; key: string; unified: string } | null>(null)

  if (agent.facts.length === 0) return null

  // Group by source file: several values from one config belong together, and the file is what
  // tells the user where to go and change them — or opens in the editor straight from the header.
  const groups: {
    key: string
    label: string
    path: string
    config?: ConfigFile
    facts: ConfigFact[]
  }[] = []
  for (const fact of agent.facts) {
    const key = `${fact.configId}:${fact.configPath}`
    const group = groups.find((candidate) => candidate.key === key)
    if (group) {
      group.facts.push(fact)
    } else {
      groups.push({
        key,
        label: fact.configLabel,
        path: fact.configPath,
        config: agent.configs.find((candidate) => candidate.id === fact.configId),
        facts: [fact],
      })
    }
  }

  return (
    <>
      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <h3 className="text-[0.9375rem]">{t('agent.facts.title')}</h3>
          <p className="text-muted text-[0.75rem]">{t('agent.facts.hint')}</p>
        </div>

        <AnimatedList grouped={false} className="flex flex-col gap-4">
          {groups.map((group) => (
            <div key={group.key} className="flex flex-col gap-1">
              <Tooltip content={group.path}>
                {group.config ? (
                  <button
                    type="button"
                    className="text-faint hover:text-foreground focus-visible:outline-ring w-fit rounded text-[0.6875rem] font-medium tracking-wide outline-none"
                    onClick={() => setOpen(group.config ?? null)}
                  >
                    {group.label}
                  </button>
                ) : (
                  <span className="text-faint w-fit text-[0.6875rem] font-medium tracking-wide">
                    {group.label}
                  </span>
                )}
              </Tooltip>
              <AnimatedList
                as="ul"
                grouped={false}
                className="grid grid-cols-1 gap-x-8 sm:grid-cols-2"
              >
                {group.facts.map((fact) => (
                  <FactRow
                    key={fact.id}
                    agentId={agent.id}
                    fact={fact}
                    config={group.config}
                    onShowDiff={(file, key, unified) => setDiff({ file, key, unified })}
                  />
                ))}
              </AnimatedList>
            </div>
          ))}
        </AnimatedList>
      </Card>

      {open ? (
        <DocumentEditorDialog
          key={open.path}
          agentId={agent.id}
          document={configDocument(open)}
          onOpenChange={() => setOpen(null)}
        />
      ) : null}

      {diff ? (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) setDiff(null)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('editor.previewTitle', { file: diff.file })}</DialogTitle>
              <DialogDescription>{diff.key}</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <DiffView unified={diff.unified} />
            </DialogBody>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}

function FactRow({
  agentId,
  fact,
  config,
  onShowDiff,
}: {
  agentId: string
  fact: ConfigFact
  config?: ConfigFile
  onShowDiff: (file: string, key: string, unified: string) => void
}) {
  const { t } = useTranslation()
  const reveal = useRevealConfigFact()
  const preview = usePreviewConfigFact()
  const save = useSaveConfigFact()
  const remove = useRemoveConfigFact()
  const browser = useBrowser()
  const [shown, setShown] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [removing, setRemoving] = useState(false)
  // The hash the row was read at. Fetched while the row is open — for an edit or for the removal
  // dialog — it is what turns a file changed outside Ahabby into a refusal instead of a write.
  const snapshot = useDocumentSnapshot(agentId, fact.configPath, editing || removing)

  const value = fact.masked ? (shown ?? fact.value) : fact.value
  // A masked value is not the real one, so nothing may act on it until it is revealed.
  const actionable = !fact.masked || shown !== null
  // The backend refuses a read-only or missing file anyway; the affordance is not offered too.
  const editable = config?.editable === true && config.exists === true
  const busy = preview.isPending || save.isPending || remove.isPending

  /** The hash the file is at right now — the row's own read, or a fresh one if it has not landed. */
  const readBaseSha256 = async () => {
    if (snapshot.data?.sha256) return snapshot.data.sha256
    const fetched = await snapshot.refetch()
    return fetched.data?.sha256
  }

  const submit = async () => {
    const next = draft.trim()
    if (next === '') {
      toast.error(t('agent.facts.empty'))
      return
    }
    const baseSha256 = await readBaseSha256()
    if (!baseSha256) {
      toast.error(t('agent.facts.editFailed'))
      return
    }

    const edit = { agentId, path: fact.configPath, key: fact.key, value: next, baseSha256 }
    try {
      const result = await preview.mutateAsync(edit)
      if (result.errors.length > 0) {
        toast.error(
          t('editor.validationFailed', { format: config?.format ?? '' }),
          result.errors[0],
        )
        return
      }
      if (!result.inSync) {
        toast.error(t('editor.staleFile'), t('editor.staleHint'))
        return
      }
      await save.mutateAsync(edit)
      setEditing(false)
      setDraft('')
      toast.success(t('agent.facts.saved'), `${fact.configLabel} · ${fact.key}`, {
        label: t('agent.facts.showDiff'),
        onClick: () => onShowDiff(fact.configLabel, fact.key, result.unified),
      })
    } catch (error) {
      toastAppError(error, 'agent.facts.editFailed')
    }
  }

  const cancel = () => {
    setEditing(false)
    setDraft('')
  }

  /** Delete this one entry from the file — the dialog is the confirmation, the call says so. */
  const runRemove = async () => {
    const baseSha256 = await readBaseSha256()
    if (!baseSha256) {
      toast.error(t('agent.facts.removeFailed'))
      return
    }
    try {
      await remove.mutateAsync({ agentId, path: fact.configPath, key: fact.key, baseSha256 })
      setRemoving(false)
      toast.success(t('agent.facts.removed'), `${fact.configLabel} · ${fact.key}`)
    } catch (error) {
      toastAppError(error, 'agent.facts.removeFailed')
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-0.5 py-1.5">
      <span className="text-faint text-[0.6875rem] tracking-wide uppercase">
        {t(`agent.facts.kind.${fact.kind}`)}
      </span>
      <div className="flex min-w-0 items-center gap-1">
        {editing ? (
          <input
            autoFocus
            aria-label={t('agent.facts.edit')}
            placeholder={t('agent.facts.newValue')}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void submit()
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                cancel()
              }
            }}
            className="border-border bg-surface-2 text-foreground placeholder:text-faint focus-visible:outline-ring min-w-0 flex-1 rounded-md border px-2 py-1 font-mono text-[0.8125rem] outline-none"
          />
        ) : (
          <Tooltip content={`${fact.key} · ${value}`}>
            <code className="text-foreground min-w-0 flex-1 truncate font-mono text-[0.8125rem]">
              {value}
            </code>
          </Tooltip>
        )}

        {editing ? (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('agent.facts.save')}
              loading={busy}
              onClick={() => void submit()}
            >
              {busy ? null : <Check className="size-3.5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('common.cancel')}
              disabled={busy}
              onClick={cancel}
            >
              <X className="size-3.5" />
            </Button>
          </>
        ) : (
          <>
            {editable ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('agent.facts.edit')}
                onClick={() => {
                  setDraft(fact.masked ? '' : fact.value)
                  setEditing(true)
                }}
              >
                <Pencil className="size-3.5" />
              </Button>
            ) : null}

            {editable ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('agent.facts.remove')}
                onClick={() => setRemoving(true)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            ) : null}

            {fact.masked ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={shown ? t('agent.facts.hide') : t('agent.facts.show')}
                loading={reveal.isPending}
                onClick={() => {
                  if (shown) {
                    setShown(null)
                    return
                  }
                  reveal.mutate(
                    { agentId, path: fact.configPath, key: fact.key },
                    {
                      onSuccess: (revealed) => setShown(revealed),
                      onError: (error) => toastAppError(error, 'agent.facts.revealFailed'),
                    },
                  )
                }}
              >
                {reveal.isPending ? null : shown ? (
                  <EyeOff className="size-3.5" />
                ) : (
                  <Eye className="size-3.5" />
                )}
              </Button>
            ) : null}

            {(fact.kind === 'url' || fact.kind === 'proxy') && actionable ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('agent.facts.open')}
                onClick={() => browser.open(value)}
              >
                <ExternalLink className="size-3.5" />
              </Button>
            ) : null}

            {actionable ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('agent.facts.copy')}
                onClick={() => {
                  void copyText(value).then((ok) => {
                    if (ok) toast.success(t('toast.copied'), value)
                  })
                }}
              >
                <Copy className="size-3.5" />
              </Button>
            ) : null}
          </>
        )}
      </div>

      {removing ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next) setRemoving(false)
          }}
          title={t('agent.facts.removeTitle', { key: fact.key })}
          description={t('agent.facts.removeBody', { file: fact.configLabel })}
          confirmLabel={t('agent.facts.removeConfirm')}
          busy={remove.isPending}
          onConfirm={() => void runRemove()}
        />
      ) : null}
    </div>
  )
}
