import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ipc } from '@/shared/api/ipc'
import type { RemoteItem } from '@/shared/bindings/RemoteItem'
import type { SyncItem } from '@/shared/bindings/SyncItem'
import type { SyncStatus } from '@/shared/bindings/SyncStatus'
import { renderWithProviders } from '@/test/render'

import { CloudActionsProvider } from './CloudActions'
import { CloudSummaryCard } from './CloudSummaryCard'

vi.mock('@/shared/api/ipc', () => ({
  ipc: {
    syncStatus: vi.fn(),
    listSyncItems: vi.fn(),
    listRemoteSyncItems: vi.fn(),
    pushSyncItems: vi.fn(),
    pullSyncItems: vi.fn(),
    deleteRemoteSyncItem: vi.fn(),
    previewSyncPull: vi.fn(),
    readSyncItem: vi.fn(),
    readRemoteSyncItem: vi.fn(),
    compareSyncItem: vi.fn(),
  },
}))

const CONNECTED: SyncStatus = {
  provider: 'gist',
  enabled: true,
  mode: 'manual',
  connected: true,
  running: false,
}

const base = {
  ownerId: 'demo',
  ownerName: 'Demo',
  ownerKind: 'agent',
  isDirectory: false,
  files: 1,
  sizeBytes: 40,
  editable: true,
  exists: true,
  hasSecrets: false,
  syncedAtMs: null,
} as const

const SKILL: SyncItem = {
  ...base,
  id: 'skill|pdf#a',
  key: 'skill|pdf',
  kind: 'skill',
  name: 'pdf',
  label: 'pdf',
  path: '/home/u/.demo/skills/pdf',
  relativePath: '~/.demo/skills/pdf',
  isDirectory: true,
  status: 'unsynced',
  remoteId: null,
  remoteUri: null,
}

const CONFIG: SyncItem = {
  ...base,
  id: 'config|settings.json#b',
  key: 'config|settings.json',
  kind: 'config',
  name: 'settings.json',
  label: 'settings.json',
  path: '/home/u/.demo/settings.json',
  relativePath: '~/.demo/settings.json',
  status: 'modified',
  remoteId: 'gist-1',
  remoteUri: 'https://gist.github.com/gist-1',
}

const CONFIG_COPY: RemoteItem = {
  remoteId: 'gist-1',
  key: CONFIG.key,
  ownerId: 'demo',
  ownerName: 'Demo',
  ownerKind: 'agent',
  kind: 'config',
  name: 'settings.json',
  label: 'settings.json',
  relativePath: CONFIG.relativePath,
  isDirectory: false,
  files: 1,
  sizeBytes: 40,
  hash: 'sha256:a',
  description: '[Ahabby] config|settings.json',
  uri: 'https://gist.github.com/gist-1',
  updatedAtMs: 1_760_000_000_000,
  hasSecrets: false,
}

/** A copy this machine has no file for at all. */
const CLOUD_ONLY: RemoteItem = {
  ...CONFIG_COPY,
  remoteId: 'gist-9',
  key: 'skill|report',
  kind: 'skill',
  name: 'report',
  label: 'report',
  relativePath: '~/.demo/skills/report',
  isDirectory: true,
  uri: 'https://gist.github.com/gist-9',
}

function render() {
  return renderWithProviders(
    <CloudActionsProvider owner={{ id: 'demo', name: 'Demo', icon: null }}>
      <CloudSummaryCard />
    </CloudActionsProvider>,
  )
}

const run = (uploaded: number, downloaded: number) =>
  ({
    kind: 'push',
    uploaded,
    downloaded,
    deleted: 0,
    skipped: 0,
    failed: 0,
    results: [],
    startedAtMs: 0,
    finishedAtMs: 0,
  }) as never

describe('CloudSummaryCard', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.mocked(ipc.syncStatus).mockResolvedValue(CONNECTED)
    vi.mocked(ipc.listSyncItems).mockResolvedValue({
      items: [SKILL, CONFIG],
      unsynced: 1,
      modified: 1,
      missing: 0,
    })
    vi.mocked(ipc.listRemoteSyncItems).mockResolvedValue({
      items: [CONFIG_COPY, CLOUD_ONLY],
      fetchedAtMs: 1,
      fromCache: false,
    })
    vi.mocked(ipc.pushSyncItems).mockResolvedValue({ data: run(1, 0) } as never)
    vi.mocked(ipc.pullSyncItems).mockResolvedValue({ data: run(0, 1) } as never)
  })

  it('lists what can be uploaded and restored, and saves the ticked rows', async () => {
    render()

    // The files are behind the disclosure: the card opens on the summary alone. The toggle only
    // exists once the connection has answered, so waiting for it is waiting for the real card.
    const toggle = await screen.findByRole('button', { name: 'Files to move' })
    expect(screen.queryByText('Save to the cloud')).toBeNull()

    fireEvent.click(toggle)

    // Two rows can be uploaded (a new skill, a changed config), inside the group that names them.
    const upload = await screen.findByRole('region', { name: 'Save to the cloud' })
    expect(within(upload).getByLabelText('pdf')).toBeDefined()
    expect(within(upload).getByLabelText('settings.json')).toBeDefined()

    // A bulk action with nothing ticked is off; one tick turns it on for exactly that row.
    expect(within(upload).getByRole('button', { name: 'Save 0' })).toHaveProperty('disabled', true)
    fireEvent.click(within(upload).getByLabelText('pdf'))
    fireEvent.click(within(upload).getByRole('button', { name: 'Save 1' }))

    await waitFor(() =>
      expect(ipc.pushSyncItems).toHaveBeenCalledWith([{ ownerId: 'demo', itemId: 'skill|pdf#a' }]),
    )
  })

  it('restores the ticked copies only after the confirmation', async () => {
    render()

    fireEvent.click(await screen.findByRole('button', { name: 'Files to move' }))
    // The cloud-only copy is in the list too, so a fresh machine can pull a file it never had.
    fireEvent.click(await screen.findByLabelText('report'))
    fireEvent.click(screen.getByRole('button', { name: 'Restore 1' }))

    const dialog = await screen.findByRole('dialog')
    expect(ipc.pullSyncItems).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore 1' }))
    await waitFor(() =>
      expect(ipc.pullSyncItems).toHaveBeenCalledWith(
        [{ remoteId: 'gist-9', ownerId: 'demo' }],
        true,
      ),
    )
  })
})
