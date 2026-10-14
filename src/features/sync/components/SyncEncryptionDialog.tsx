import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyRound } from 'lucide-react'

import { Button } from '@/shared/ui/Button'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { Input } from '@/shared/ui/Input'

import {
  useClearSyncEncryption,
  useDeleteRemoteSyncLibrary,
  useRemoteSyncItems,
  useSetSyncPassword,
  useUnlockSyncEncryption,
} from '../api/hooks'

/** Which of the five things the one encryption dialog does. */
export type SyncEncryptionMode = 'set' | 'unlock' | 'rotate' | 'disable' | 'forgot'

/** The password the backend asks for — `SyncCipher::MIN_PASSWORD` on the Rust side. */
const MIN_PASSWORD = 8

/**
 * The whole of cloud encryption, in one dialog: sealing the library, unlocking this machine,
 * changing the password, turning it off and the forgotten-password way out.
 *
 * `mode` decides the title, the sentence about what will happen to the cloud and the command, so
 * the five paths cannot drift apart. `set` and `rotate` are deliberately one flow behind two
 * names: both write the library to a fresh gist, which is why both say the URL changes.
 *
 * The password lives in this component's own state and nowhere else — it is handed to the command
 * as an argument and the component is unmounted with the dialog, so nothing can cache it. Setting
 * and changing it ask for it twice; unlocking this machine asks once.
 * Everything that reaches a locked library goes through here, and a caller that was interrupted
 * passes `onUnlocked` to run what it wanted once the password landed.
 */
export function SyncEncryptionDialog({
  mode,
  onClose,
  onUnlocked,
}: {
  mode: SyncEncryptionMode
  onClose: () => void
  /** Run after a successful unlock — the action a locked library refused to do. */
  onUnlocked?: () => void
}) {
  const { t } = useTranslation()
  const remote = useRemoteSyncItems()
  const seal = useSetSyncPassword()
  const unlock = useUnlockSyncEncryption()
  const clear = useClearSyncEncryption()
  const remove = useDeleteRemoteSyncLibrary()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')

  /** What the cloud holds, as the listing last read it: what the copy is about to change. */
  const copies = remote.data?.items.length ?? 0
  // The button mirrors the backend's rule and never replaces it: the command refuses a short
  // password whatever this screen offers. It counts characters (`str::chars`), not code units, so
  // an emoji is one character — `String.length` would refuse a password the command accepts.
  const longEnough = [...password].length >= MIN_PASSWORD

  if (mode === 'disable') {
    return (
      <ConfirmDialog
        open
        onOpenChange={(open) => (open ? undefined : onClose())}
        title={t('sync.encryptionDisable')}
        description={
          <>
            {t('sync.encryptionDisableConfirm')}
            {copies > 0 ? (
              <span className="block pt-2">{t('sync.encryptionCopies', { count: copies })}</span>
            ) : null}
          </>
        }
        confirmLabel={t('sync.encryptionDisable')}
        busy={clear.isPending}
        onConfirm={() => clear.mutate(undefined, { onSuccess: onClose })}
      />
    )
  }

  if (mode === 'forgot') {
    return (
      <ConfirmDialog
        open
        onOpenChange={(open) => (open ? undefined : onClose())}
        title={t('sync.encryptionForgot')}
        description={t('sync.encryptionForgotConfirm')}
        confirmLabel={t('sync.encryptionForgot')}
        busy={remove.isPending}
        onConfirm={() => remove.mutate(true, { onSuccess: onClose })}
      />
    )
  }

  const title =
    mode === 'set'
      ? t('sync.encryptionSet')
      : mode === 'rotate'
        ? t('sync.encryptionRotate')
        : t('sync.encryptionUnlock')
  const sealing = mode === 'set' || mode === 'rotate'
  const pending = seal.isPending || unlock.isPending
  const failed = seal.isError || unlock.isError
  // A password is usually set once, so a mistyped one seals the whole library under something
  // nobody knows — and the way out is deleting it. Both fields must agree before the command is
  // offered; unlocking a library this machine cannot read needs no second field, since a wrong
  // password is answered by the library itself.
  const repeated = !sealing || password === confirmation
  const mismatch = sealing && confirmation.length > 0 && !repeated

  const submit = () => {
    if (mode === 'unlock') {
      unlock.mutate(password, {
        onSuccess: () => {
          onClose()
          onUnlocked?.()
        },
      })
      return
    }
    seal.mutate(password, { onSuccess: onClose })
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="w-[min(520px,92vw)]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {mode === 'unlock' ? t('sync.encryptionLockedLibrary') : t('sync.encryptionHint')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 px-6 pb-5">
          {copies > 0 ? (
            <p className="text-muted text-[0.8125rem]">
              {t('sync.encryptionCopies', { count: copies })}
            </p>
          ) : null}
          {sealing ? (
            <p className="text-faint text-[0.75rem]">{t('sync.encryptionMovedHint')}</p>
          ) : null}

          <label className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5 text-sm">
              <KeyRound className="size-3.5" aria-hidden />
              {t('sync.encryptionPassword')}
            </span>
            <Input
              type="password"
              value={password}
              autoComplete="off"
              spellCheck={false}
              aria-label={t('sync.encryptionPassword')}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {sealing ? (
            <label className="flex flex-col gap-1.5">
              <span className="flex items-center gap-1.5 text-sm">
                <KeyRound className="size-3.5" aria-hidden />
                {t('sync.encryptionPasswordConfirm')}
              </span>
              <Input
                type="password"
                value={confirmation}
                autoComplete="off"
                spellCheck={false}
                aria-label={t('sync.encryptionPasswordConfirm')}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
          ) : null}
          <p className="text-faint text-[0.75rem]">{t('sync.encryptionPasswordHint')}</p>

          {mismatch ? (
            <p role="alert" className="text-danger-fg text-[0.8125rem]">
              {t('sync.encryptionPasswordMismatch')}
            </p>
          ) : null}
          {failed ? (
            <p role="alert" className="text-danger-fg text-[0.8125rem]">
              {t('sync.encryptionFailed')}
            </p>
          ) : null}
        </div>

        <div className="border-border flex items-center justify-end gap-2 border-t px-6 py-4">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!longEnough || !repeated}
            loading={pending}
            onClick={submit}
          >
            {pending && sealing ? t('sync.encryptionSetting') : title}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
