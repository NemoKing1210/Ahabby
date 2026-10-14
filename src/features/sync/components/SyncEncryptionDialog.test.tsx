import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ipc } from '@/shared/api/ipc'
import type { RemoteItem } from '@/shared/bindings/RemoteItem'
import type { RemoteList } from '@/shared/bindings/RemoteList'
import type { SyncRun } from '@/shared/bindings/SyncRun'
import { renderWithProviders } from '@/test/render'

import { SyncEncryptionDialog, type SyncEncryptionMode } from './SyncEncryptionDialog'

vi.mock('@/shared/api/ipc', () => ({
  ipc: {
    listRemoteSyncItems: vi.fn(),
    setSyncPassword: vi.fn(),
    unlockSyncEncryption: vi.fn(),
    clearSyncEncryption: vi.fn(),
    deleteRemoteSyncLibrary: vi.fn(),
  },
}))

const COPY: RemoteItem = {
  remoteId: 'gist-1',
  key: 'instruction|agents.md',
  ownerId: 'claude-code',
  ownerName: 'Claude Code',
  ownerKind: 'agent',
  kind: 'instruction',
  name: 'AGENTS.md',
  label: 'AGENTS.md',
  relativePath: '~/.claude/AGENTS.md',
  isDirectory: false,
  files: 1,
  sizeBytes: 41,
  hash: 'sha256:aaa',
  description: '[Ahabby] sync',
  uri: 'https://gist.github.com/gist-1',
  updatedAtMs: 1_760_000_000_000,
  hasSecrets: false,
}

const LIST: RemoteList = {
  items: [COPY, { ...COPY, remoteId: 'gist-2', key: 'config|settings.json' }],
  fetchedAtMs: 0,
  fromCache: false,
  locked: false,
}

function run(): SyncRun {
  return {
    kind: 'encrypt',
    uploaded: 1,
    downloaded: 0,
    deleted: 0,
    skipped: 0,
    failed: 0,
    results: [],
    atMs: 0,
  }
}

/** The name a mode's own submit button carries. */
const SUBMIT: Record<SyncEncryptionMode, string> = {
  set: 'Encrypt the cloud',
  rotate: 'Change the password',
  unlock: 'Unlock this machine',
  disable: 'Turn off encryption',
  forgot: 'Forgot the password',
}

function renderDialog(mode: SyncEncryptionMode) {
  return renderWithProviders(
    <SyncEncryptionDialog mode={mode} onClose={vi.fn()} onUnlocked={vi.fn()} />,
  )
}

beforeEach(() => {
  vi.mocked(ipc.listRemoteSyncItems).mockResolvedValue(LIST)
  vi.mocked(ipc.setSyncPassword).mockResolvedValue(run())
  vi.mocked(ipc.unlockSyncEncryption).mockResolvedValue({
    provider: 'gist',
    enabled: true,
    mode: 'manual',
    connected: true,
    running: false,
    encryption: { enabled: true, kid: '9f3a1c02' },
  })
  vi.mocked(ipc.clearSyncEncryption).mockResolvedValue(run())
  vi.mocked(ipc.deleteRemoteSyncLibrary).mockResolvedValue(run())
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SyncEncryptionDialog', () => {
  it('refuses a password below the eight characters the backend asks for', async () => {
    for (const mode of ['set', 'rotate', 'unlock'] as SyncEncryptionMode[]) {
      const user = userEvent.setup()
      const view = renderDialog(mode)
      const submit = screen.getByRole('button', { name: SUBMIT[mode] })
      // Setting a password and changing one are the two modes that ask for it twice.
      const sealing = mode === 'set' || mode === 'rotate'
      const repeat = () => screen.getByLabelText('Repeat the password')

      // Empty and one character short of the rule are both refused here, where the backend's
      // own refusal would only arrive after a round trip.
      expect(submit).toBeDisabled()
      await user.type(screen.getByLabelText('Password'), 'seven77')
      if (sealing) await user.type(repeat(), 'seven77')
      expect(submit).toBeDisabled()

      await user.type(screen.getByLabelText('Password'), 'x')
      if (sealing) await user.type(repeat(), 'x')
      expect(submit).toBeEnabled()
      view.unmount()
    }
  })

  it('refuses to seal the library while the two fields do not agree', async () => {
    for (const mode of ['set', 'rotate'] as SyncEncryptionMode[]) {
      const user = userEvent.setup()
      const view = renderDialog(mode)

      // Long enough, and one character apart — exactly the typo that would seal the library under
      // a password nobody knows, which is why setting one is the flow that asks twice.
      await user.type(screen.getByLabelText('Password'), 'a long enough password')
      await user.type(screen.getByLabelText('Repeat the password'), 'a long enough passwrod')

      expect(screen.getByRole('button', { name: SUBMIT[mode] })).toBeDisabled()
      expect(screen.getByRole('alert')).toHaveTextContent('The two passwords are not the same.')
      expect(ipc.setSyncPassword).not.toHaveBeenCalled()

      await user.clear(screen.getByLabelText('Repeat the password'))
      await user.type(screen.getByLabelText('Repeat the password'), 'a long enough password')

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: SUBMIT[mode] })).toBeEnabled()
      view.unmount()
    }
  })

  it('seals the library with the password, and says it moves to a fresh gist', async () => {
    const user = userEvent.setup()
    renderDialog('set')

    // What it will do to the cloud, and how much of it — the listing is the count.
    expect(await screen.findByText('2 copies in the cloud')).toBeInTheDocument()
    expect(screen.getByText(/its URL changes/)).toBeInTheDocument()

    await user.type(screen.getByLabelText('Password'), 'a long enough password')
    await user.type(screen.getByLabelText('Repeat the password'), 'a long enough password')
    await user.click(screen.getByRole('button', { name: 'Encrypt the cloud' }))

    await waitFor(() => expect(ipc.setSyncPassword).toHaveBeenCalledWith('a long enough password'))
  })

  it('unlocks this machine and hands the caller what was interrupted', async () => {
    const onUnlocked = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(
      <SyncEncryptionDialog mode="unlock" onClose={vi.fn()} onUnlocked={onUnlocked} />,
    )

    await user.type(screen.getByLabelText('Password'), 'a long enough password')
    await user.click(screen.getByRole('button', { name: 'Unlock this machine' }))

    await waitFor(() =>
      expect(ipc.unlockSyncEncryption).toHaveBeenCalledWith('a long enough password'),
    )
    await waitFor(() => expect(onUnlocked).toHaveBeenCalled())
  })

  it('says so in the dialog when the password does not open the library', async () => {
    vi.mocked(ipc.unlockSyncEncryption).mockRejectedValue({
      code: 'invalid_input',
      message: 'the cloud library is encrypted — enter the password',
    })
    const user = userEvent.setup()
    renderDialog('unlock')

    await user.type(screen.getByLabelText('Password'), 'the wrong password')
    await user.click(screen.getByRole('button', { name: 'Unlock this machine' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That password did not open the library.',
    )
  })

  it('deletes the whole cloud library only after the confirmation', async () => {
    const user = userEvent.setup()
    renderDialog('forgot')

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/whole cloud library is deleted/)).toBeInTheDocument()
    expect(ipc.deleteRemoteSyncLibrary).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Forgot the password' }))
    await waitFor(() => expect(ipc.deleteRemoteSyncLibrary).toHaveBeenCalledWith(true))
  })

  it('turns encryption off only after the confirmation', async () => {
    const user = userEvent.setup()
    renderDialog('disable')

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/written back to the cloud unencrypted/)).toBeInTheDocument()
    expect(ipc.clearSyncEncryption).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Turn off encryption' }))
    await waitFor(() => expect(ipc.clearSyncEncryption).toHaveBeenCalled())
  })
})
