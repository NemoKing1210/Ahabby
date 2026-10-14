import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CloudCog, CloudUpload, KeyRound, Link2Off, RefreshCw, TriangleAlert } from 'lucide-react'

import type { SyncKind } from '@/shared/bindings/SyncKind'
import type { SyncSettings } from '@/shared/bindings/SyncSettings'
import { useAgents } from '@/features/agents/api/queries'
import { useProjects } from '@/features/projects/api/queries'
import { cn } from '@/shared/lib/cn'
import { formatRelative } from '@/shared/lib/format'
import { SHARED_OWNER_ID } from '@/shared/lib/owners'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { Input } from '@/shared/ui/Input'
import { Select } from '@/shared/ui/Select'
import { SwitchField } from '@/shared/ui/Switch'
import { Textarea } from '@/shared/ui/Textarea'

import {
  useConsolidateSyncLibrary,
  usePushAllSync,
  useReencryptSync,
  useRemoteSyncItems,
  useSetSyncToken,
  useSyncStatus,
  useVerifySync,
} from '@/features/sync/api/hooks'
import {
  SyncEncryptionDialog,
  type SyncEncryptionMode,
} from '@/features/sync/components/SyncEncryptionDialog'
import { SyncLibrary } from '@/features/sync/components/SyncLibrary'
import { SYNC_KINDS } from '@/features/sync/lib/labels'

import {
  SettingRow,
  SettingsPageHeading,
  SettingsSection,
  SettingsSections,
} from '../components/SettingsSection'
import { useSettingsDraft } from '../lib/draft'

const KB = 1024
const MIN_INTERVAL = 5
const MAX_INTERVAL = 1440

/** Two buttons that read as one control — the manual/automatic choice. */
function ModeSwitch({
  value,
  onChange,
}: {
  value: SyncSettings['mode']
  onChange: (mode: SyncSettings['mode']) => void
}) {
  const { t } = useTranslation()
  const options: { value: SyncSettings['mode']; label: string }[] = [
    { value: 'manual', label: t('sync.modeManual') },
    { value: 'automatic', label: t('sync.modeAutomatic') },
  ]
  return (
    <div
      className="border-border bg-surface-2 inline-flex rounded-lg border p-0.5"
      role="group"
      aria-label={t('sync.mode')}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'ease-warm rounded-md border px-3 py-1 text-[0.8125rem] font-medium transition-colors duration-150',
            value === option.value
              ? 'border-border bg-surface text-foreground'
              : 'text-muted hover:bg-surface/70 hover:text-foreground border-transparent',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** Toggleable pill for a set of values (kinds, owners). */
function ToggleChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'ease-warm rounded-full border px-2.5 py-1 text-[0.75rem] font-medium transition-colors duration-150',
        active
          ? 'border-accent/40 bg-accent-soft text-accent-strong'
          : 'border-border bg-surface text-muted hover:border-border-strong hover:text-foreground',
      )}
    >
      {label}
    </button>
  )
}

/** The connection: the provider, the token, and who it belongs to. */
function ConnectionSection() {
  const { t } = useTranslation()
  const status = useSyncStatus()
  const setToken = useSetSyncToken()
  const verify = useVerifySync()
  const [value, setValue] = useState('')

  const connected = status.data?.connected ?? false
  const account = status.data?.account

  return (
    <SettingsSection title={t('sync.connection')} hint={t('sync.connectionHint')}>
      <SettingRow label={t('sync.provider')} hint={t('sync.providerHint')}>
        <Select
          ariaLabel={t('sync.provider')}
          value="gist"
          onValueChange={() => undefined}
          options={[{ value: 'gist', label: t('sync.providerGist') }]}
          className="min-w-40"
        />
      </SettingRow>

      {connected ? (
        <div className="flex flex-col gap-3 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="success" dot="success">
              {account
                ? t('sync.connectedAs', { login: account.login })
                : t('sync.connectedAccount')}
            </Badge>
            {status.data?.tokenHint ? (
              <span className="text-faint font-mono text-[0.75rem]">{status.data.tokenHint}</span>
            ) : null}
            {account && account.gists > 0 ? (
              <span className="text-faint text-[0.75rem]">
                {t('sync.connectedGists', { count: account.gists })}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              loading={verify.isPending}
              onClick={() => verify.mutate()}
            >
              <RefreshCw className="size-3.5" aria-hidden />
              {t('sync.verify')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              loading={setToken.isPending}
              onClick={() => setToken.mutate({ provider: 'gist', token: '' })}
            >
              <Link2Off className="size-3.5" aria-hidden />
              {t('sync.disconnect')}
            </Button>
          </div>
          {verify.data ? (
            <p className="text-success-fg text-[0.8125rem]">
              {t('sync.verified', { login: verify.data.login })}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2 py-3">
          <label className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5 text-sm">
              <KeyRound className="size-3.5" aria-hidden />
              {t('sync.token')}
            </span>
            <Input
              type="password"
              value={value}
              autoComplete="off"
              spellCheck={false}
              placeholder={t('sync.tokenPlaceholder')}
              aria-label={t('sync.token')}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
          <p className="text-faint max-w-prose text-[0.75rem]">{t('sync.tokenHint')}</p>
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={value.trim().length === 0}
              loading={setToken.isPending}
              onClick={() =>
                setToken.mutate(
                  { provider: 'gist', token: value },
                  { onSuccess: () => setValue('') },
                )
              }
            >
              {t('sync.connect')}
            </Button>
            <Button variant="link" size="sm" asChild>
              <a href="https://github.com/settings/tokens/new?scopes=gist&description=Ahabby%20sync">
                {t('sync.createToken')}
              </a>
            </Button>
          </div>
        </div>
      )}
    </SettingsSection>
  )
}

/** The mode, what it covers, and the files it may not touch. */
function SavingSection() {
  const { t, i18n } = useTranslation()
  const { draft, update } = useSettingsDraft()
  const agents = useAgents()
  const projects = useProjects()
  const status = useSyncStatus()
  const pushAll = usePushAllSync()

  const sync = draft.sync
  const patchSync = (patch: Partial<SyncSettings>) => update({ sync: { ...sync, ...patch } })
  const everyOwner = sync.autoOwners.length === 0

  const owners = [
    { id: SHARED_OWNER_ID, name: t('library.shared') },
    ...(agents.data?.agents ?? [])
      .filter((agent) => agent.status === 'installed')
      .map((agent) => ({ id: agent.id, name: agent.name })),
    ...(projects.data?.projects ?? []).map((project) => ({ id: project.id, name: project.name })),
  ]

  const toggleKind = (kind: SyncKind) =>
    patchSync({
      autoKinds: sync.autoKinds.includes(kind)
        ? sync.autoKinds.filter((entry) => entry !== kind)
        : [...sync.autoKinds, kind],
    })

  const toggleOwner = (id: string) => {
    if (everyOwner) {
      patchSync({ autoOwners: [id] })
      return
    }
    const next = sync.autoOwners.includes(id)
      ? sync.autoOwners.filter((entry) => entry !== id)
      : [...sync.autoOwners, id]
    patchSync({ autoOwners: next.length === owners.length ? [] : next })
  }

  const format = (ms: number | null | undefined) =>
    ms ? (formatRelative(ms, i18n.language) ?? '') : t('sync.never')

  return (
    <SettingsSection title={t('sync.saving')} hint={t('sync.savingHint')}>
      <SwitchField
        id="sync-enabled"
        label={t('sync.enabled')}
        hint={t('sync.enabledHint')}
        checked={sync.enabled}
        onCheckedChange={(enabled) => patchSync({ enabled })}
      />

      <SettingRow label={t('sync.mode')}>
        <ModeSwitch value={sync.mode} onChange={(mode) => patchSync({ mode })} />
      </SettingRow>
      <p className="text-muted max-w-prose pb-3 text-[0.8125rem]">
        {sync.mode === 'automatic' ? t('sync.modeAutomaticHint') : t('sync.modeManualHint')}
      </p>

      {sync.enabled && sync.mode === 'automatic' ? (
        <>
          <div className="flex flex-col gap-2 py-3">
            <span className="text-sm">{t('sync.kinds')}</span>
            <p className="text-muted max-w-prose text-[0.8125rem]">{t('sync.kindsHint')}</p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {SYNC_KINDS.map((kind) => (
                <ToggleChip
                  key={kind}
                  label={t(`sync.kind.${kind}`)}
                  active={sync.autoKinds.includes(kind)}
                  onClick={() => toggleKind(kind)}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2 py-3">
            <span className="text-sm">{t('sync.owners')}</span>
            <p className="text-muted max-w-prose text-[0.8125rem]">{t('sync.ownersHint')}</p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              <ToggleChip
                label={t('sync.ownersAll')}
                active={everyOwner}
                onClick={() => patchSync({ autoOwners: [] })}
              />
              {owners.map((owner) => (
                <ToggleChip
                  key={owner.id}
                  label={owner.name}
                  active={!everyOwner && sync.autoOwners.includes(owner.id)}
                  onClick={() => toggleOwner(owner.id)}
                />
              ))}
            </div>
          </div>

          <SettingRow label={t('sync.interval')} hint={t('sync.intervalHint')}>
            <div className="flex items-center gap-2">
              <Input
                className="w-20"
                type="number"
                min={MIN_INTERVAL}
                max={MAX_INTERVAL}
                value={sync.autoIntervalMinutes}
                aria-label={t('sync.interval')}
                onChange={(event) =>
                  patchSync({ autoIntervalMinutes: Number(event.target.value) || MIN_INTERVAL })
                }
              />
              <span className="text-muted text-[0.8125rem]">{t('sync.minutes')}</span>
            </div>
          </SettingRow>

          <SwitchField
            id="sync-on-scan"
            label={t('sync.onScan')}
            hint={t('sync.onScanHint')}
            checked={sync.autoOnScan}
            onCheckedChange={(autoOnScan) => patchSync({ autoOnScan })}
          />
        </>
      ) : null}

      <SwitchField
        id="sync-secrets"
        label={t('sync.includeSecrets')}
        hint={t('sync.includeSecretsHint')}
        checked={sync.includeSecrets}
        onCheckedChange={(includeSecrets) => patchSync({ includeSecrets })}
      />

      <div className="flex flex-col gap-1.5 py-3">
        <span className="text-sm">{t('sync.exclude')}</span>
        <Textarea
          rows={2}
          value={sync.excludePatterns.join('\n')}
          placeholder={t('sync.excludePlaceholder')}
          aria-label={t('sync.exclude')}
          onChange={(event) =>
            patchSync({
              excludePatterns: event.target.value
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line.length > 0),
            })
          }
        />
        <p className="text-faint text-[0.75rem]">{t('sync.excludeHint')}</p>
      </div>

      <SettingRow label={t('sync.maxFile')} hint={t('sync.maxFileHint')}>
        <div className="flex items-center gap-2">
          <Input
            className="w-24"
            type="number"
            min={1}
            max={5120}
            value={Math.round(sync.maxFileBytes / KB)}
            aria-label={t('sync.maxFile')}
            onChange={(event) =>
              patchSync({ maxFileBytes: (Number(event.target.value) || 512) * KB })
            }
          />
          <span className="text-muted text-[0.8125rem]">kB</span>
        </div>
      </SettingRow>

      <div className="border-border flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <div className="text-muted flex flex-col gap-0.5 text-[0.75rem]">
          <span>
            {t('sync.lastSave')}: {format(status.data?.lastPushMs)}
          </span>
          {status.data?.lastPullMs ? (
            <span>
              {t('sync.lastRestore')}: {format(status.data.lastPullMs)}
            </span>
          ) : null}
          {status.data?.lastError ? (
            <span className="text-danger-fg">{status.data.lastError}</span>
          ) : null}
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={!sync.enabled}
          loading={pushAll.isPending}
          onClick={() => pushAll.mutate()}
        >
          <CloudUpload className="size-3.5" aria-hidden />
          {t('sync.saveEverything')}
        </Button>
      </div>
    </SettingsSection>
  )
}

/**
 * What the cloud still holds in the layout this version replaced, and the one button that
 * collects it.
 *
 * Only shown while the status reports something to collect (`SyncMigration` is set by every
 * reading of the account that finds old gists). The counts come from that listing: how many gists
 * there are is known, how many copies they hold is not until the migration has read them — the
 * item count is the migration's to fill in — so a zero is "not counted yet" and the sentence then
 * names the gists alone rather than claiming an empty cloud.
 */
function MigrationBanner() {
  const { t } = useTranslation()
  const status = useSyncStatus()
  const consolidate = useConsolidateSyncLibrary()
  const [confirming, setConfirming] = useState(false)

  const migration = status.data?.migration
  if (!migration) return null

  const sentence =
    migration.items > 0
      ? t('sync.migration', { items: migration.items, gists: migration.gists })
      : t('sync.migrationGists', { count: migration.gists })

  return (
    <Card className="border-warning/40 bg-warning/5 flex flex-col gap-3 p-5">
      <div className="flex items-start gap-2">
        <TriangleAlert className="text-warning-fg mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="flex flex-col gap-1">
          <p className="text-foreground text-[0.8125rem]">{sentence}</p>
          <p className="text-muted max-w-prose text-[0.75rem]">{t('sync.migrationHint')}</p>
        </div>
      </div>
      <div>
        <Button
          variant="secondary"
          size="sm"
          loading={consolidate.isPending}
          onClick={() => setConfirming(true)}
        >
          {t('sync.migrationAction')}
        </Button>
      </div>

      {confirming ? (
        <ConfirmDialog
          open
          tone="primary"
          onOpenChange={(open) => (open ? undefined : setConfirming(false))}
          title={t('sync.migrationAction')}
          // The sentence carries the numbers, so the confirmation names what is collected and
          // what is deleted without a second source for either count.
          description={
            <>
              {sentence}
              <span className="block pt-2">{t('sync.migrationConfirm')}</span>
            </>
          }
          confirmLabel={t('sync.migrationAction')}
          busy={consolidate.isPending}
          onConfirm={() => consolidate.mutate(true, { onSuccess: () => setConfirming(false) })}
        />
      ) : null}
    </Card>
  )
}

/**
 * The password: sealing the library, unlocking this machine, changing it and turning it off.
 *
 * Which of the three shapes the section takes comes from two answers, neither of which is the
 * other's substitute: whether this machine holds a key (`SyncStatus.encryption.enabled`) and
 * whether the cloud holds a sealed library it cannot read (`RemoteList.locked`). A key held is
 * encryption on — there is no separate switch — and a locked listing is the one state no field of
 * the status can carry.
 */
function EncryptionSection() {
  const { t } = useTranslation()
  const status = useSyncStatus()
  const remote = useRemoteSyncItems(status.data?.connected ?? false)
  const reencrypt = useReencryptSync()
  const [dialog, setDialog] = useState<SyncEncryptionMode | null>(null)
  const [forgotShown, setForgotShown] = useState(false)

  const encryption = status.data?.encryption
  const enabled = encryption?.enabled ?? false
  const locked = !enabled && (remote.data?.locked ?? false)

  return (
    <SettingsSection title={t('sync.encryption')} hint={t('sync.encryptionHint')}>
      {enabled ? (
        <div className="flex flex-col gap-3 py-3">
          <div>
            <Badge tone="success" dot="success">
              {t('sync.encryptionKey', { kid: encryption?.kid ?? '' })}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setDialog('rotate')}>
              {t('sync.encryptionRotate')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={reencrypt.isPending}
              onClick={() => reencrypt.mutate()}
            >
              {t('sync.encryptionReencrypt')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDialog('disable')}>
              {t('sync.encryptionDisable')}
            </Button>
          </div>
        </div>
      ) : locked ? (
        <div className="flex flex-col gap-3 py-3">
          <p className="text-muted max-w-prose text-[0.8125rem]">
            {t('sync.encryptionLockedLibrary')}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" size="sm" onClick={() => setDialog('unlock')}>
              <KeyRound className="size-3.5" aria-hidden />
              {t('sync.encryptionUnlock')}
            </Button>
            {/* The forgotten password is behind one click: it names the only way out before the
                button that takes it does anything. */}
            {forgotShown ? (
              <Button variant="danger" size="sm" onClick={() => setDialog('forgot')}>
                {t('sync.encryptionForgot')}
              </Button>
            ) : (
              <Button variant="link" size="sm" onClick={() => setForgotShown(true)}>
                {t('sync.encryptionForgot')}
              </Button>
            )}
          </div>
          {forgotShown ? (
            <p className="text-faint max-w-prose text-[0.75rem]">
              {t('sync.encryptionForgotHint')}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3 py-3">
          <p className="text-muted max-w-prose text-[0.8125rem]">
            {t('sync.encryptionPasswordHint')}
          </p>
          <p className="text-faint max-w-prose text-[0.75rem]">{t('sync.encryptionMovedHint')}</p>
          <div>
            <Button variant="secondary" size="sm" onClick={() => setDialog('set')}>
              {t('sync.encryptionSet')}
            </Button>
          </div>
        </div>
      )}

      {dialog ? (
        <SyncEncryptionDialog key={dialog} mode={dialog} onClose={() => setDialog(null)} />
      ) : null}
    </SettingsSection>
  )
}

/**
 * The Sync area of Settings: the connection, when saving happens, and the library of what can be
 * saved and what already is.
 */
export function SettingsSyncPage() {
  const { t } = useTranslation()
  const { draft } = useSettingsDraft()

  return (
    <div className="flex flex-col gap-5">
      <SettingsPageHeading
        icon={CloudCog}
        title={t('settings.sync')}
        hint={t('settings.syncHint')}
      />

      <SettingsSections>
        <MigrationBanner />
        <ConnectionSection />
        <SavingSection />
        <EncryptionSection />
      </SettingsSections>

      <div className="mt-1 flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-medium">{t('sync.library')}</h3>
          <p className="text-muted max-w-prose text-[0.8125rem]">{t('sync.libraryHint')}</p>
        </div>
        {draft.sync.enabled ? (
          <SyncLibrary />
        ) : (
          <p className="border-border text-muted rounded-xl border border-dashed px-4 py-6 text-center text-[0.8125rem]">
            {t('sync.disabledHint')}
          </p>
        )}
      </div>
    </div>
  )
}
