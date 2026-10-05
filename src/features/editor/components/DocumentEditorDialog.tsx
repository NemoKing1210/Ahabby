import { redo, redoDepth, undo, undoDepth } from '@codemirror/commands'
import { openSearchPanel } from '@codemirror/search'
import type { EditorView } from '@codemirror/view'
import type { ReactCodeMirrorProps, ReactCodeMirrorRef } from '@uiw/react-codemirror'
import {
  Braces,
  Copy,
  Diff,
  Eraser,
  History,
  Redo2,
  RotateCcw,
  Save,
  Search,
  ShieldAlert,
  Undo2,
  WrapText,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'

import { isStaleFileError } from '@/shared/api/errors'
import type { DiffPreview } from '@/shared/bindings/DiffPreview'
import { copyText } from '@/shared/lib/clipboard'
import { cn } from '@/shared/lib/cn'
import { formatBytes, formatRelative } from '@/shared/lib/format'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { CodeViewer } from '@/shared/ui/CodeViewer'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { PathRow } from '@/shared/ui/PathRow'
import { Spinner } from '@/shared/ui/Primitives'
import { toast, toastAppError } from '@/shared/ui/Toast'
import { Tooltip } from '@/shared/ui/Tooltip'

import {
  useDocumentBackups,
  useDocumentSnapshot,
  usePreviewDocumentSave,
  useRestoreDocumentBackup,
  useSaveDocument,
} from '../api/hooks'
import type { EditorDocument } from '../model'
import { DiffView } from './DiffView'

/** How long the editor waits after the last keystroke before validating the draft. */
const PREVIEW_DEBOUNCE_MS = 400

/** Pretty-print JSON. Returns `null` when the text is not parseable JSON (JSONC included). */
function prettyJson(value: string): string | null {
  try {
    return `${JSON.stringify(JSON.parse(value), null, 2)}\n`
  } catch {
    return null
  }
}

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  active = false,
}: {
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  label: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
}) {
  return (
    <Tooltip content={label}>
      {/* The trigger must be an element that still receives pointer events while disabled. */}
      <span className="inline-flex">
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn(active && 'bg-surface-3 text-foreground')}
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
        >
          <Icon className="size-4" aria-hidden />
        </Button>
      </span>
    </Tooltip>
  )
}

function Divider() {
  return <span className="bg-border mx-1 h-4 w-px" aria-hidden />
}

/**
 * The editor.
 *
 * Order of operations is fixed and visible to the user: edit → review (validation + diff +
 * staleness check) → save. Rust re-checks the hash and takes a backup before writing, so the
 * sequence cannot be short-circuited by the UI.
 *
 * The draft is kept as an override of the loaded snapshot rather than copied into state by an
 * effect: nothing is duplicated, and "the file changed under me" stays expressible. Validation
 * is re-run on a debounce, so the error banner and the Save button always describe the text that
 * is on screen.
 */
export function DocumentEditorDialog({
  agentId,
  document: doc,
  onOpenChange,
}: {
  agentId: string
  document: EditorDocument
  onOpenChange: () => void
}) {
  const { t, i18n } = useTranslation()
  const snapshot = useDocumentSnapshot(agentId, doc.path, true)
  const preview = usePreviewDocumentSave()
  // `mutate` is stable across renders; the mutation object around it is not.
  const { mutate: previewMutate } = preview
  const save = useSaveDocument()
  const restore = useRestoreDocumentBackup()
  const backups = useDocumentBackups(agentId, doc.path, true)

  const editorRef = useRef<ReactCodeMirrorRef | null>(null)
  const diffRef = useRef<HTMLDivElement | null>(null)
  const backupsRef = useRef<HTMLDivElement | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const [checked, setChecked] = useState<{ content: string; data: DiffPreview } | null>(null)
  const [history, setHistory] = useState({ undo: 0, redo: 0 })
  const [showDiff, setShowDiff] = useState(false)
  const [showBackups, setShowBackups] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null)
  const [wrap, setWrap] = useState(false)
  const [staleWarning, setStaleWarning] = useState(false)

  const loaded = snapshot.data?.content ?? null
  const value = draft ?? loaded ?? ''
  const dirty = draft !== null && draft !== loaded
  // The UI may lower editability (a "View" action) but never raise it: the manifest's own
  // `editable` and the snapshot's answer both have to say yes.
  const editable = doc.editable && snapshot.data?.editable === true
  const exists = snapshot.data?.exists === true
  const truncated = snapshot.data?.truncated === true
  const baseSha256 = snapshot.data?.sha256
  const checkedCurrent = checked !== null && checked.content === value
  const errors = checkedCurrent ? checked.data.errors : []
  const inSync = !staleWarning && (checkedCurrent ? checked.data.inSync : true)
  const canSave = dirty && editable && inSync && errors.length === 0 && !save.isPending

  const runPreview = useCallback(
    (content: string, sha256: string) => {
      previewMutate(
        { agentId, path: doc.path, content, baseSha256: sha256 },
        {
          onSuccess: (data) => setChecked({ content, data }),
          onError: (error) => {
            setChecked(null)
            if (isStaleFileError(error)) setStaleWarning(true)
            toastAppError(error)
          },
        },
      )
    },
    [agentId, doc.path, previewMutate],
  )

  useEffect(() => {
    if (!dirty || !editable || truncated || baseSha256 === undefined) return
    const content = value
    const timer = window.setTimeout(() => runPreview(content, baseSha256), PREVIEW_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [value, dirty, editable, truncated, baseSha256, runPreview])

  /**
   * Bring a panel that was just opened into view: the editor keeps a floor height, so on a short
   * window the diff or the backup list can start below the fold.
   */
  useEffect(() => {
    if (showDiff) diffRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [showDiff])

  useEffect(() => {
    if (showBackups) backupsRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [showBackups])

  const reload = () => {
    setStaleWarning(false)
    setDraft(null)
    setChecked(null)
    setShowDiff(false)
    void snapshot.refetch()
  }

  const withView = (action: (view: EditorView) => unknown) => {
    const view = editorRef.current?.view
    if (view) action(view)
  }

  const onUpdate = useCallback<NonNullable<ReactCodeMirrorProps['onUpdate']>>((update) => {
    const next = { undo: undoDepth(update.state), redo: redoDepth(update.state) }
    setHistory((current) =>
      current.undo === next.undo && current.redo === next.redo ? current : next,
    )
  }, [])

  const submit = useCallback(() => {
    const base = snapshot.data
    if (!base) return
    save.mutate(
      { agentId, path: doc.path, content: value, baseSha256: base.sha256 },
      {
        onSuccess: (result) => {
          toast.success(
            t('editor.saveSuccess', { file: doc.label }),
            result.data.backupPath
              ? t('editor.backupTaken', { path: result.data.backupPath })
              : undefined,
          )
          onOpenChange()
        },
        onError: (error) => {
          if (isStaleFileError(error)) setStaleWarning(true)
          toastAppError(error)
        },
      },
    )
  }, [agentId, doc.path, doc.label, onOpenChange, save, snapshot.data, t, value])

  const lines = value.length === 0 ? 0 : value.split('\n').length
  const canFormat = editable && doc.format === 'json'

  // `Mod-s` saves, like in any editor. CodeMirror leaves the shortcut free, so this lives here,
  // where the current draft and the validation state are both in scope.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      if (canSave) submit()
      else if (dirty && editable && baseSha256 !== undefined) {
        setShowDiff(true)
        runPreview(value, baseSha256)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canSave, submit, dirty, editable, baseSha256, value, runPreview])

  const checkStatus = !editable
    ? null
    : preview.isPending
      ? t('editor.checking')
      : errors.length > 0
        ? t('editor.invalid')
        : checkedCurrent && checked.data.unified.length > 0
          ? `${t('editor.added', { count: checked.data.added })} · ${t('editor.removed', {
              count: checked.data.removed,
            })}`
          : checkedCurrent
            ? t('editor.verified')
            : dirty
              ? t('editor.unchecked')
              : null

  return (
    <>
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent
          className="flex h-[85vh] w-[min(1100px,96vw)] flex-col"
          footer={
            <>
              <div className="text-faint mr-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.75rem]">
                <span>{t('editor.lines', { count: lines })}</span>
                <span>{t('editor.characters', { count: value.length })}</span>
                {snapshot.data && exists ? (
                  <span>{formatBytes(snapshot.data.sizeBytes) ?? ''}</span>
                ) : null}
                {snapshot.data && exists ? (
                  <span>{formatRelative(snapshot.data.modifiedMs, i18n.language)}</span>
                ) : null}
                {editable ? (
                  <span className={dirty ? 'text-warning-fg' : undefined}>
                    {dirty ? t('editor.dirty') : t('editor.clean')}
                  </span>
                ) : null}
                {checkStatus ? <span>{checkStatus}</span> : null}
              </div>

              <Button variant="ghost" onClick={onOpenChange}>
                {t('common.close')}
              </Button>
              <Tooltip content={t('editor.previewTitle', { file: doc.label })}>
                <span className="inline-flex">
                  <Button
                    variant="secondary"
                    disabled={!dirty || !editable || baseSha256 === undefined || !inSync}
                    onClick={() => {
                      if (baseSha256 === undefined) return
                      setShowDiff(true)
                      runPreview(value, baseSha256)
                    }}
                  >
                    {preview.isPending ? (
                      <Spinner />
                    ) : (
                      <ShieldAlert className="size-3.5" aria-hidden />
                    )}
                    {t('editor.preview')}
                  </Button>
                </span>
              </Tooltip>
              <Button variant="primary" disabled={!canSave} onClick={submit}>
                <Save className="size-3.5" aria-hidden />
                {save.isPending ? t('common.saving') : t('common.save')}
              </Button>
            </>
          }
        >
          <DialogHeader className="pb-3">
            <div className="flex flex-wrap items-center gap-2 pr-10">
              <DialogTitle>{doc.label}</DialogTitle>
              <Badge tone="outline">{doc.format}</Badge>
              {snapshot.data && !editable ? (
                <Badge tone="neutral">{t('common.readOnly')}</Badge>
              ) : null}
              {exists ? null : <Badge tone="neutral">{t('configs.missing')}</Badge>}
            </div>
            <DialogDescription>
              <PathRow path={doc.path} className="mt-1" />
            </DialogDescription>
          </DialogHeader>

          {/* Quick actions: everything that does not write to disk lives here. */}
          <div className="border-border flex items-center gap-0.5 border-y px-4 py-1.5">
            {editable ? (
              <>
                <ToolbarButton
                  icon={Undo2}
                  label={t('editor.undo')}
                  disabled={history.undo === 0}
                  onClick={() =>
                    withView((view) =>
                      undo({
                        state: view.state,
                        dispatch: (transaction) => view.dispatch(transaction),
                      }),
                    )
                  }
                />
                <ToolbarButton
                  icon={Redo2}
                  label={t('editor.redo')}
                  disabled={history.redo === 0}
                  onClick={() =>
                    withView((view) =>
                      redo({
                        state: view.state,
                        dispatch: (transaction) => view.dispatch(transaction),
                      }),
                    )
                  }
                />
                <Divider />
                <ToolbarButton
                  icon={RotateCcw}
                  label={t('editor.revert')}
                  disabled={!dirty}
                  onClick={() => setDraft(null)}
                />
                <ToolbarButton
                  icon={Eraser}
                  label={t('editor.clear')}
                  disabled={value.length === 0}
                  onClick={() => setDraft('')}
                />
                {canFormat ? (
                  <ToolbarButton
                    icon={Braces}
                    label={t('editor.format')}
                    onClick={() => {
                      const formatted = prettyJson(value)
                      if (formatted === null) {
                        toast.error(t('editor.formatFailed'))
                        return
                      }
                      setDraft(formatted)
                    }}
                  />
                ) : null}
                <Divider />
              </>
            ) : null}

            <ToolbarButton
              icon={Search}
              label={t('editor.find')}
              onClick={() =>
                withView((view) => {
                  view.focus()
                  openSearchPanel(view)
                })
              }
            />
            <ToolbarButton
              icon={Copy}
              label={t('editor.copyContent')}
              disabled={value.length === 0}
              onClick={() => {
                void copyText(value).then((ok) =>
                  ok ? toast.success(t('editor.copied')) : toast.error(t('editor.copyFailed')),
                )
              }}
            />
            <ToolbarButton
              icon={WrapText}
              label={t('editor.wrap')}
              active={wrap}
              onClick={() => setWrap((current) => !current)}
            />
            <Divider />
            <ToolbarButton
              icon={Diff}
              label={t('editor.diff')}
              active={showDiff}
              disabled={preview.data === undefined}
              onClick={() => setShowDiff((shown) => !shown)}
            />
            <ToolbarButton
              icon={History}
              label={t('editor.backups')}
              active={showBackups}
              onClick={() => setShowBackups((shown) => !shown)}
            />
            {backups.data && backups.data.length > 0 ? (
              <Badge tone="neutral">{backups.data.length}</Badge>
            ) : null}
          </div>

          <DialogBody className="flex flex-col gap-3 pt-3">
            {staleWarning ? (
              <div className="border-warning/40 bg-surface flex flex-col gap-2 rounded-lg border p-3">
                <span className="text-foreground text-[0.8125rem]">{t('editor.staleFile')}</span>
                <span className="text-muted text-[0.75rem]">{t('editor.staleHint')}</span>
                <div>
                  <Button variant="secondary" size="sm" onClick={reload}>
                    <RotateCcw className="size-3.5" aria-hidden />
                    {t('editor.reload')}
                  </Button>
                </div>
              </div>
            ) : null}

            {errors.length > 0 ? (
              <div className="border-danger/40 flex flex-col gap-1 rounded-lg border p-3">
                <span className="text-danger-fg text-[0.8125rem]">
                  {t('editor.validationFailed', { format: doc.format.toUpperCase() })}
                </span>
                <ul className="text-muted font-mono text-[0.75rem] break-all">
                  {errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {snapshot.isLoading || snapshot.data === undefined ? (
              <div className="text-muted flex min-h-[42vh] flex-1 items-center justify-center gap-2 text-[0.8125rem]">
                <Spinner /> {t('common.loading')}
              </div>
            ) : truncated ? (
              <p className="text-warning-fg text-[0.8125rem]">
                {t('configs.truncated', { size: formatBytes(snapshot.data.sizeBytes) ?? '' })}
              </p>
            ) : (
              <div className="min-h-[42vh] flex-1">
                <CodeViewer
                  value={value}
                  format={doc.format}
                  editable={editable}
                  onChange={setDraft}
                  onUpdate={onUpdate}
                  wrap={wrap}
                  editorRef={editorRef}
                  height="100%"
                  ariaLabel={doc.label}
                />
              </div>
            )}

            {showDiff && preview.data ? (
              <div ref={diffRef}>
                <DiffView unified={preview.data.unified} />
              </div>
            ) : null}

            {showBackups ? (
              <div
                ref={backupsRef}
                className="border-border flex max-h-[28vh] flex-col gap-2 overflow-y-auto rounded-lg border p-3"
              >
                <span className="text-faint text-[0.6875rem] tracking-wide uppercase">
                  {t('editor.backups')}
                </span>
                {backups.data && backups.data.length > 0 ? (
                  <ul className="flex flex-col gap-1">
                    {backups.data.map((backup) => (
                      <li
                        key={backup.path}
                        className="flex items-center justify-between gap-3 rounded-lg px-1 py-1"
                      >
                        <div className="flex min-w-0 flex-col">
                          <span className="text-foreground text-[0.8125rem]">
                            {formatRelative(backup.createdMs, i18n.language)}
                          </span>
                          <span className="text-faint truncate font-mono text-[0.6875rem]">
                            {backup.path}
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-muted text-[0.75rem]">
                            {formatBytes(backup.sizeBytes)}
                          </span>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setRestoreTarget(backup.path)}
                          >
                            {t('editor.restore')}
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted text-[0.75rem]">{t('editor.noBackups')}</p>
                )}
              </div>
            ) : null}
          </DialogBody>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={restoreTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRestoreTarget(null)
        }}
        title={t('editor.restoreTitle')}
        description={t('editor.restoreBody', {
          file: doc.label,
          when:
            formatRelative(
              backups.data?.find((backup) => backup.path === restoreTarget)?.createdMs ?? 0,
              i18n.language,
            ) ?? t('common.unknown'),
        })}
        confirmLabel={t('editor.restore')}
        busy={restore.isPending}
        onConfirm={() => {
          if (!restoreTarget) return
          restore.mutate(
            { agentId, path: doc.path, backupPath: restoreTarget },
            {
              onSuccess: () => {
                toast.success(t('toast.restored'))
                setRestoreTarget(null)
                setDraft(null)
                setChecked(null)
                void snapshot.refetch()
              },
              onError: (error) => toastAppError(error),
            },
          )
        }}
      />
    </>
  )
}
