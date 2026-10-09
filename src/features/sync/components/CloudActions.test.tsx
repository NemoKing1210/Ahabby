import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ipc } from '@/shared/api/ipc'
import type { RemoteItem } from '@/shared/bindings/RemoteItem'
import type { SyncContent } from '@/shared/bindings/SyncContent'
import type { SyncContentSide } from '@/shared/bindings/SyncContentSide'
import type { SyncItem } from '@/shared/bindings/SyncItem'
import type { SyncStatus } from '@/shared/bindings/SyncStatus'
import { renderWithProviders } from '@/test/render'

import { CloudActionsProvider, CloudItemAction, useCloudActions } from './CloudActions'
import { CloudOnlyCard } from './CloudOnlyCard'

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
  tokenHint: 'ghp_…',
  running: false,
}

const SKILL: SyncItem = {
  id: 'skill|pdf#abc',
  key: 'skill|pdf',
  ownerId: 'demo',
  ownerName: 'Demo',
  ownerKind: 'agent',
  kind: 'skill',
  name: 'pdf',
  label: 'pdf',
  path: '/home/u/.demo/skills/pdf',
  relativePath: '~/.demo/skills/pdf',
  isDirectory: true,
  files: 1,
  sizeBytes: 100,
  editable: true,
  exists: true,
  hasSecrets: false,
  status: 'unsynced',
  remoteId: null,
  remoteUri: null,
  syncedAtMs: null,
}

const CLOUD_ONLY: RemoteItem = {
  remoteId: 'gist-9',
  key: 'skill|report',
  ownerId: 'demo',
  ownerName: 'Demo',
  ownerKind: 'agent',
  kind: 'skill',
  name: 'report',
  label: 'report',
  relativePath: '~/.demo/skills/report',
  isDirectory: true,
  files: 2,
  sizeBytes: 10,
  hash: 'sha256:x',
  description: '[Ahabby] skill|report',
  uri: 'https://gist.github.com/gist-9',
  updatedAtMs: 1_760_000_000_000,
  hasSecrets: false,
}

/** Renders what the provider publishes: the chips of the local items and the cloud-only cards. */
function Harness() {
  const cloud = useCloudActions()
  if (!cloud) return null
  return (
    <div>
      {cloud.items.map((item) => (
        <div key={item.id}>
          <span>{item.label}</span>
          <CloudItemAction item={item} />
        </div>
      ))}
      {cloud.cloudOnly(['skill']).map((copy) => (
        <CloudOnlyCard key={copy.remoteId} remote={copy} />
      ))}
    </div>
  )
}

function render(owner = { id: 'demo', name: 'Demo', icon: null }) {
  return renderWithProviders(
    <CloudActionsProvider owner={owner}>
      <Harness />
    </CloudActionsProvider>,
  )
}

describe('CloudActionsProvider', () => {
  // RTL's auto-cleanup is not configured in this repo, so each case clears its own DOM.
  afterEach(cleanup)

  beforeEach(() => {
    vi.mocked(ipc.syncStatus).mockResolvedValue(CONNECTED)
    vi.mocked(ipc.listSyncItems).mockResolvedValue({
      items: [SKILL],
      unsynced: 1,
      modified: 0,
      missing: 0,
    })
    vi.mocked(ipc.listRemoteSyncItems).mockResolvedValue({
      items: [CLOUD_ONLY],
      fetchedAtMs: 1,
      fromCache: false,
    })
    vi.mocked(ipc.pushSyncItems).mockResolvedValue({
      data: {
        kind: 'push',
        uploaded: 1,
        downloaded: 0,
        deleted: 0,
        skipped: 0,
        failed: 0,
        results: [],
        startedAtMs: 0,
        finishedAtMs: 0,
      },
    } as never)
  })

  it('saves a local item by its ref, never by a path', async () => {
    render()

    expect(await screen.findByText('pdf')).toBeDefined()
    expect(await screen.findByText('Not saved')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(ipc.pushSyncItems).toHaveBeenCalledWith([
        { ownerId: 'demo', itemId: 'skill|pdf#abc' },
      ]),
    )
  })

  it('shows a copy this machine does not hold and restores it through its preview', async () => {
    vi.mocked(ipc.previewSyncPull).mockResolvedValue({
      remoteId: CLOUD_ONLY.remoteId,
      ownerId: 'demo',
      ownerName: 'Demo',
      kind: 'skill',
      name: 'report',
      label: 'report',
      destination: '/home/u/.demo/skills/report',
      isDirectory: true,
      canApply: true,
      files: [],
      remoteHash: 'sha256:x',
    })

    render()

    expect(await screen.findByText('report')).toBeDefined()
    // The copy is offered as a card of its own, with the one action it has.
    expect(screen.getByText('Only in the cloud')).toBeDefined()
    // The local skill's chip also carries a Restore, disabled for want of a copy: the enabled one
    // is the cloud-only card's.
    const restore = screen
      .getAllByRole('button', { name: 'Restore' })
      .find((button) => !button.hasAttribute('disabled'))
    fireEvent.click(restore as HTMLButtonElement)

    await waitFor(() =>
      expect(ipc.previewSyncPull).toHaveBeenCalledWith(CLOUD_ONLY.remoteId, 'demo'),
    )
  })

  it('renders no cloud surface before sync is turned on', async () => {
    vi.mocked(ipc.syncStatus).mockResolvedValue({ ...CONNECTED, enabled: false })

    render()

    await waitFor(() => expect(ipc.syncStatus).toHaveBeenCalled())
    expect(screen.queryByText('Not saved')).toBeNull()
    expect(screen.queryByText('report')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  /** A skill this machine holds and the account holds too — the shape a comparison needs. */
  function withACopy() {
    vi.mocked(ipc.listSyncItems).mockResolvedValue({
      items: [{ ...SKILL, status: 'modified', remoteId: 'gist-7', remoteUri: 'u' }],
      unsynced: 0,
      modified: 1,
      missing: 0,
    })
    vi.mocked(ipc.listRemoteSyncItems).mockResolvedValue({
      items: [
        {
          ...CLOUD_ONLY,
          remoteId: 'gist-7',
          key: SKILL.key,
          kind: 'skill',
          name: 'pdf',
          label: 'pdf',
        },
      ],
      fetchedAtMs: 1,
      fromCache: false,
    })

    const side = (which: SyncContentSide): SyncContent => ({
      side: which,
      key: SKILL.key,
      name: 'pdf',
      label: 'pdf',
      ownerId: 'demo',
      ownerName: 'Demo',
      kind: 'skill',
      isDirectory: true,
      exists: true,
      files: [
        {
          path: 'SKILL.md',
          text: '# pdf',
          sizeBytes: 5,
          binary: false,
          truncated: false,
          hash: 'sha256:x',
        },
      ],
    })

    vi.mocked(ipc.readSyncItem).mockResolvedValue(side('local'))
    vi.mocked(ipc.compareSyncItem).mockResolvedValue({
      key: SKILL.key,
      name: 'pdf',
      label: 'pdf',
      kind: 'skill',
      ownerId: 'demo',
      ownerName: 'Demo',
      local: side('local'),
      cloud: side('remote'),
      files: [
        {
          path: 'SKILL.md',
          status: 'same',
          binary: false,
          localSizeBytes: 5,
          cloudSizeBytes: 5,
          left: '# pdf',
          right: '# pdf',
          truncated: false,
        },
      ],
      changed: 0,
      identical: true,
    })
  }

  it('opens the reader of a file this machine holds', async () => {
    withACopy()
    render()

    fireEvent.click(await screen.findByRole('button', { name: 'View content' }))
    await waitFor(() => expect(ipc.readSyncItem).toHaveBeenCalledWith('demo', 'skill|pdf#abc'))
  })

  it('compares a file with the copy the account holds', async () => {
    withACopy()
    render()

    fireEvent.click(await screen.findByRole('button', { name: 'Compare with the cloud' }))
    await waitFor(() => expect(ipc.compareSyncItem).toHaveBeenCalledWith('gist-7', 'demo'))
  })

  it('leaves the comparison off for a file the cloud never saw', async () => {
    render()

    await screen.findByText('Not saved')
    expect(screen.getByRole('button', { name: 'Compare with the cloud' })).toHaveProperty(
      'disabled',
      true,
    )
  })
})
