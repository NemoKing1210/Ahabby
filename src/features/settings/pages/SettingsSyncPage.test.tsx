import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ipc } from '@/shared/api/ipc'
import type { RemoteItem } from '@/shared/bindings/RemoteItem'
import type { Settings } from '@/shared/bindings/Settings'
import type { SyncItem } from '@/shared/bindings/SyncItem'
import type { SyncStatus } from '@/shared/bindings/SyncStatus'
import { initI18n } from '@/shared/i18n'
import { resetSessionState } from '@/shared/lib/sessionState'
import { TooltipProvider } from '@/shared/ui/Tooltip'
import { emptyScanReport, emptySyncSettings, testSettings } from '@/test/fixtures'
import { BrowserProvider } from '@/features/browser/context'

import { settingsRoutes } from '../routes'

vi.mock('@/shared/ui/CodeViewer', () => ({
  CodeViewer: ({ value, ariaLabel }: { value: string; ariaLabel?: string }) => (
    <pre aria-label={ariaLabel} data-testid="code-viewer">
      {value}
    </pre>
  ),
}))

vi.mock('@/shared/api/ipc', () => ({
  ipc: {
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    listPackageManagers: vi.fn(),
    userCatalogDir: vi.fn(),
    backupRoot: vi.fn(),
    listTerminals: vi.fn(),
    revealPath: vi.fn(),
    setWindowTheme: vi.fn(),
    cachedAgents: vi.fn(),
    listAgents: vi.fn(),
    syncStatus: vi.fn(),
    setSyncToken: vi.fn(),
    verifySyncConnection: vi.fn(),
    listSyncItems: vi.fn(),
    listRemoteSyncItems: vi.fn(),
    previewSyncPull: vi.fn(),
    readSyncItem: vi.fn(),
    readRemoteSyncItem: vi.fn(),
    compareSyncItem: vi.fn(),
    pushSyncItems: vi.fn(),
    pushAllSyncItems: vi.fn(),
    pullSyncItems: vi.fn(),
    deleteRemoteSyncItem: vi.fn(),
  },
}))

const INSTRUCTION: SyncItem = {
  id: 'instruction|agents.md#abc',
  key: 'instruction|agents.md',
  ownerId: 'claude-code',
  ownerName: 'Claude Code',
  ownerKind: 'agent',
  kind: 'instruction',
  name: 'AGENTS.md',
  label: 'AGENTS.md',
  path: '/home/u/.claude/AGENTS.md',
  relativePath: '~/.claude/AGENTS.md',
  isDirectory: false,
  files: 1,
  sizeBytes: 41,
  editable: true,
  exists: true,
  hasSecrets: false,
  status: 'modified',
  remoteId: 'gist-1',
  remoteUri: 'https://gist.github.com/gist-1',
  syncedAtMs: 1_760_000_000_000,
}

const CONFIG: SyncItem = {
  ...INSTRUCTION,
  id: 'config|settings.json#zzz',
  key: 'config|settings.json',
  kind: 'config',
  name: 'settings.json',
  label: 'Settings',
  path: '/home/u/.claude/settings.json',
  relativePath: '~/.claude/settings.json',
  status: 'modified',
}

const CURSOR: SyncItem = {
  ...INSTRUCTION,
  id: 'instruction|rules.md#cur',
  key: 'instruction|rules.md',
  ownerId: 'cursor-agent',
  ownerName: 'Cursor',
  name: 'rules.md',
  label: 'Rules',
  path: '/home/u/.cursor/rules.md',
  relativePath: '~/.cursor/rules.md',
  status: 'unsynced',
  remoteId: null,
  remoteUri: null,
  syncedAtMs: null,
}

const REMOTE: RemoteItem = {
  remoteId: 'gist-1',
  key: INSTRUCTION.key,
  ownerId: INSTRUCTION.ownerId,
  ownerName: INSTRUCTION.ownerName,
  ownerKind: 'agent',
  kind: 'instruction',
  name: 'AGENTS.md',
  label: 'AGENTS.md',
  relativePath: INSTRUCTION.relativePath,
  isDirectory: false,
  files: 1,
  sizeBytes: 41,
  hash: 'sha256:aaa',
  description:
    '[Ahabby] claude-code :: instruction :: instruction|agents.md :: 1 :: 41 :: ~/.claude/AGENTS.md',
  uri: 'https://gist.github.com/gist-1',
  updatedAtMs: 1_760_000_000_000,
  hasSecrets: false,
}

const SKILL: SyncItem = {
  id: 'skill|pdf#abc',
  key: 'skill|pdf',
  ownerId: 'claude-code',
  ownerName: 'Claude Code',
  ownerKind: 'agent',
  kind: 'skill',
  name: 'pdf',
  label: 'pdf',
  path: '/home/u/.claude/skills/pdf',
  relativePath: '~/.claude/skills/pdf',
  isDirectory: true,
  files: 2,
  sizeBytes: 2063,
  editable: true,
  exists: true,
  hasSecrets: false,
  status: 'modified',
  remoteId: 'gist-1',
  remoteUri: 'https://gist.github.com/gist-1',
  syncedAtMs: 1_760_000_000_000,
}

const SHARED_ITEM: SyncItem = {
  ...INSTRUCTION,
  id: 'skill|shared-skill#sh',
  key: 'skill|shared-skill',
  ownerId: 'shared',
  ownerName: 'Shared',
  kind: 'skill',
  name: 'shared-skill',
  label: 'Shared skill',
  isDirectory: true,
  path: '/home/u/.agents/skills/shared-skill',
  relativePath: '~/.agents/skills/shared-skill',
  status: 'unsynced',
  remoteId: null,
  remoteUri: null,
  syncedAtMs: null,
}

const PROJECT_ITEM: SyncItem = {
  ...INSTRUCTION,
  id: 'config|mcp.json#prj',
  key: 'config|mcp.json',
  ownerId: 'project:abc',
  ownerName: 'night-owl',
  kind: 'config',
  name: '.mcp.json',
  label: 'Project settings',
  path: '/home/u/w/night-owl/.mcp.json',
  relativePath: 'w/night-owl/.mcp.json',
  status: 'unsynced',
  remoteId: null,
  remoteUri: null,
  syncedAtMs: null,
}

const REMOTE_CURSOR: RemoteItem = {
  ...REMOTE,
  remoteId: 'gist-9',
  key: CURSOR.key,
  ownerId: CURSOR.ownerId,
  ownerName: CURSOR.ownerName,
  name: CURSOR.name,
  label: CURSOR.label,
  relativePath: CURSOR.relativePath,
}

function status(overrides: Partial<SyncStatus> = {}): SyncStatus {
  return {
    provider: 'gist',
    enabled: true,
    mode: 'manual',
    connected: false,
    running: false,
    ...overrides,
  }
}

/** Open `/settings/sync` with the answers a case needs. */
async function openSync(
  options: {
    settings?: Settings
    status?: SyncStatus
    items?: SyncItem[]
    remote?: RemoteItem[]
  } = {},
) {
  const data = options.settings ?? testSettings({ sync: { ...emptySyncSettings, enabled: true } })
  vi.mocked(ipc.getSettings).mockResolvedValue(data)
  vi.mocked(ipc.saveSettings).mockImplementation((next: Settings) => Promise.resolve(next))
  vi.mocked(ipc.listPackageManagers).mockResolvedValue([])
  vi.mocked(ipc.userCatalogDir).mockResolvedValue('/catalog')
  vi.mocked(ipc.backupRoot).mockResolvedValue('/backups')
  vi.mocked(ipc.listTerminals).mockResolvedValue({ options: [], defaultCwd: '/home' })
  vi.mocked(ipc.cachedAgents).mockResolvedValue(emptyScanReport)
  vi.mocked(ipc.syncStatus).mockResolvedValue(options.status ?? status())
  vi.mocked(ipc.listSyncItems).mockResolvedValue({
    items: options.items ?? [],
    unsynced: options.items?.length ?? 0,
    modified: 0,
    missing: 0,
  })
  vi.mocked(ipc.listRemoteSyncItems).mockResolvedValue({
    items: options.remote ?? [],
    fetchedAtMs: 0,
    fromCache: false,
  })
  vi.mocked(ipc.pushSyncItems).mockResolvedValue({ data: run(), report: emptyScanReport })
  vi.mocked(ipc.pushAllSyncItems).mockResolvedValue({ data: run(), report: emptyScanReport })
  vi.mocked(ipc.pullSyncItems).mockResolvedValue({ data: run(), report: emptyScanReport })

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(settingsRoutes, { initialEntries: ['/settings/sync'] })
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={initI18n('en')}>
        <TooltipProvider>
          {/* The app mounts the browser above the router, and a row's context menu offers
              "open on GitHub" through it. */}
          <BrowserProvider>
            <RouterProvider router={router} />
          </BrowserProvider>
        </TooltipProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  )
  await screen.findByRole('heading', { level: 2, name: 'Cloud sync' })
}

function run() {
  return {
    kind: 'push' as const,
    uploaded: 1,
    downloaded: 0,
    deleted: 0,
    skipped: 0,
    failed: 0,
    results: [],
    atMs: 0,
  }
}

beforeEach(() => {
  resetSessionState()
  vi.mocked(ipc.setWindowTheme).mockResolvedValue(undefined)
  window.matchMedia = (() => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  document.documentElement.removeAttribute('style')
})

describe('Settings → cloud sync', () => {
  it('needs a token before it connects, and stores it without touching the settings file', async () => {
    await openSync()
    const user = userEvent.setup()

    const connect = screen.getByRole('button', { name: 'Connect' })
    expect(connect).toBeDisabled()

    await user.type(screen.getByLabelText('Personal access token'), 'ghp_secret')
    await user.click(connect)

    await waitFor(() => expect(ipc.setSyncToken).toHaveBeenCalledWith('gist', 'ghp_secret'))
    // The token is a credential, not a setting: the document is never saved for it.
    expect(ipc.saveSettings).not.toHaveBeenCalled()
  })

  it('names the connected account and can ask GitHub again', async () => {
    vi.mocked(ipc.verifySyncConnection).mockResolvedValue({
      provider: 'gist',
      login: 'octocat',
      gists: 3,
    })
    await openSync({
      status: status({
        connected: true,
        tokenHint: 'ghp_…abcd',
        account: { provider: 'gist', login: 'octocat', gists: 3 },
      }),
    })
    const user = userEvent.setup()

    expect(await screen.findByText('Connected as octocat')).toBeInTheDocument()
    expect(screen.getByText('ghp_…abcd')).toBeInTheDocument()
    expect(screen.queryByLabelText('Personal access token')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Check connection' }))
    await waitFor(() => expect(ipc.verifySyncConnection).toHaveBeenCalled())
    expect(await screen.findByText('Connected — GitHub answers as octocat.')).toBeInTheDocument()
  })

  it('carries the sync configuration through the one Save button', async () => {
    await openSync()
    const user = userEvent.setup()

    await user.click(screen.getByRole('switch', { name: 'Include secrets' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(ipc.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          sync: expect.objectContaining({ enabled: true, includeSecrets: true }),
        }),
      ),
    )
  })

  it('says there is nothing to save on a machine that holds nothing', async () => {
    await openSync()
    expect(await screen.findByText('Nothing to save yet')).toBeInTheDocument()
  })

  it('previews a restore and only then confirms it', async () => {
    vi.mocked(ipc.previewSyncPull).mockResolvedValue({
      remoteId: 'gist-1',
      ownerId: 'claude-code',
      ownerName: 'Claude Code',
      kind: 'instruction',
      name: 'AGENTS.md',
      label: 'AGENTS.md',
      destination: '/home/u/.claude/AGENTS.md',
      isDirectory: false,
      canApply: true,
      files: [
        {
          path: 'AGENTS.md',
          action: 'replace',
          sizeBytes: 41,
          binary: false,
          unified: '--- local\n+++ cloud\n-# changed\n+# Agent rules\n',
        },
      ],
      remoteHash: 'sha256:aaa',
    })
    await openSync({
      status: status({ connected: true }),
      items: [INSTRUCTION],
      remote: [REMOTE],
    })
    const user = userEvent.setup()

    await user.click(screen.getByRole('tab', { name: /In the cloud/ }))
    await user.click(await screen.findByRole('button', { name: 'Restore' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Restore preview')).toBeInTheDocument()
    expect(within(dialog).getByText('/home/u/.claude/AGENTS.md')).toBeInTheDocument()
    expect(within(dialog).getByText('Replaced')).toBeInTheDocument()
    expect(ipc.pullSyncItems).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Restore' }))
    await waitFor(() =>
      expect(ipc.pullSyncItems).toHaveBeenCalledWith(
        [{ remoteId: 'gist-1', ownerId: 'claude-code' }],
        true,
      ),
    )
  })

  it('groups the library by owner and acts on one group', async () => {
    await openSync({
      status: status({ connected: true }),
      items: [INSTRUCTION, CONFIG, CURSOR],
    })
    const user = userEvent.setup()

    expect(await screen.findByText('Claude Code')).toBeInTheDocument()
    expect(screen.getByText('Cursor')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Save all' })).toHaveLength(2)
    // The group says how much of it is outstanding: two of Claude Code's items, one of Cursor's.
    expect(screen.getByText('2 not saved')).toBeInTheDocument()
    expect(screen.getByText('2 changed')).toBeInTheDocument()
    expect(screen.getByText('1 not saved')).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: 'Save all' })[1] as HTMLElement)
    await waitFor(() =>
      expect(ipc.pushSyncItems).toHaveBeenCalledWith([
        { ownerId: 'cursor-agent', itemId: CURSOR.id },
      ]),
    )
  })

  it('sorts a file this machine was never given last, and says what it is', async () => {
    // A declared config that was never created here: it is in the scan, and nowhere else.
    const ABSENT: SyncItem = {
      ...CONFIG,
      id: 'config|.aider.conf.yml#zzz',
      key: 'config|.aider.conf.yml',
      name: '.aider.conf.yml',
      label: '.aider.conf.yml',
      path: '/home/u/.aider.conf.yml',
      relativePath: '~/.aider.conf.yml',
      files: 0,
      sizeBytes: 0,
      exists: false,
      status: 'unsynced',
      remoteId: null,
      remoteUri: null,
      syncedAtMs: null,
    }
    await openSync({ items: [ABSENT, INSTRUCTION, CONFIG] })

    // One owner, three rows: the two files that are here, then the one that is not.
    const rows = await screen.findAllByRole('checkbox')
    expect(rows.map((box) => box.getAttribute('aria-label'))).toEqual([
      'AGENTS.md',
      'Settings',
      '.aider.conf.yml',
    ])
    // The row reports where it stands — nowhere — instead of a state it cannot have...
    expect(screen.getByText('Not on this machine')).toBeInTheDocument()
    expect(screen.queryByText('Not saved')).not.toBeInTheDocument()
    // ...and there is nothing on disk to upload, so its Save is not offered. The page's own Save
    // is a different button, so the row is what is looked in.
    const row = rows[2]?.closest('li') as HTMLElement
    expect(within(row).getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('cuts the library into owner sub-tabs, each with what it holds', async () => {
    await openSync({ items: [INSTRUCTION, CONFIG, CURSOR, SHARED_ITEM, PROJECT_ITEM] })
    const user = userEvent.setup()

    // The sub-tabs sit under the main ones: every owner kind the machine has, and how much of it.
    // They must not be painted like the page's own tabs, or the two levels read as one row.
    // The sub-tab row exists only once the half holds something, so wait for its first tab.
    await screen.findByRole('tab', { name: /Agents/ })
    expect(screen.getAllByRole('tablist').map((tablist) => tablist.dataset.variant)).toEqual([
      'primary',
      'secondary',
    ])
    expect(
      within(await screen.findByRole('tab', { name: /All/ })).getByText('5'),
    ).toBeInTheDocument()
    expect(within(screen.getByRole('tab', { name: /Agents/ })).getByText('3')).toBeInTheDocument()
    expect(within(screen.getByRole('tab', { name: /Projects/ })).getByText('1')).toBeInTheDocument()
    expect(within(screen.getByRole('tab', { name: /Shared/ })).getByText('1')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /Projects/ }))
    await waitFor(() =>
      expect(screen.queryByRole('checkbox', { name: 'AGENTS.md' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('checkbox', { name: 'Project settings' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Shared skill' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /Shared/ }))
    await screen.findByRole('checkbox', { name: 'Shared skill' })
    expect(screen.queryByRole('checkbox', { name: 'Project settings' })).not.toBeInTheDocument()
  })

  it('offers no sub-tab for a kind this machine has none of', async () => {
    await openSync({ items: [INSTRUCTION, CONFIG] })

    await screen.findByRole('tab', { name: /Agents/ })
    expect(screen.queryByRole('tab', { name: /Projects/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /Shared/ })).not.toBeInTheDocument()
  })

  it('folds one owner away without touching the other', async () => {
    await openSync({ items: [INSTRUCTION, CURSOR] })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Collapse Claude Code' }))

    await waitFor(() =>
      expect(screen.queryByRole('checkbox', { name: 'AGENTS.md' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('checkbox', { name: 'Rules' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand Claude Code' })).toBeInTheDocument()
  })

  it('narrows the library to one owner by typing its name', async () => {
    await openSync({ items: [INSTRUCTION, CONFIG, CURSOR] })
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Search items'), 'cursor')

    await waitFor(() =>
      expect(screen.queryByRole('checkbox', { name: 'AGENTS.md' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('checkbox', { name: 'Rules' })).toBeInTheDocument()
    expect(screen.getByText('Cursor')).toBeInTheDocument()
  })

  it('selects a whole owner group at once', async () => {
    await openSync({ items: [INSTRUCTION, CONFIG, CURSOR] })
    const user = userEvent.setup()

    await screen.findAllByRole('button', { name: 'Select group' })
    await user.click(screen.getAllByRole('button', { name: 'Select group' })[0] as HTMLElement)
    expect(screen.getByText('2 selected')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save 2' }))
    await waitFor(() =>
      expect(ipc.pushSyncItems).toHaveBeenCalledWith([
        { ownerId: 'claude-code', itemId: INSTRUCTION.id },
        { ownerId: 'claude-code', itemId: CONFIG.id },
      ]),
    )
  })

  it('restores a whole owner group only after the confirmation', async () => {
    await openSync({
      status: status({ connected: true }),
      items: [INSTRUCTION, CURSOR],
      remote: [REMOTE, REMOTE_CURSOR],
    })
    const user = userEvent.setup()

    await user.click(screen.getByRole('tab', { name: /In the cloud/ }))
    const restoreAll = await screen.findAllByRole('button', { name: 'Restore all' })
    await user.click(restoreAll[0] as HTMLElement)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Restore every copy?')).toBeInTheDocument()
    expect(within(dialog).getByText(/Claude Code/)).toBeInTheDocument()
    expect(ipc.pullSyncItems).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Restore all' }))
    await waitFor(() =>
      expect(ipc.pullSyncItems).toHaveBeenCalledWith(
        [{ remoteId: 'gist-1', ownerId: 'claude-code' }],
        true,
      ),
    )
  })

  it('reads an item, showing a binary file by its size', async () => {
    vi.mocked(ipc.readSyncItem).mockResolvedValue({
      side: 'local',
      key: SKILL.key,
      name: SKILL.name,
      label: SKILL.label,
      ownerId: 'claude-code',
      ownerName: 'Claude Code',
      kind: 'skill',
      isDirectory: true,
      exists: true,
      files: [
        {
          path: 'SKILL.md',
          text: '# the file body',
          sizeBytes: 15,
          binary: false,
          truncated: false,
          hash: 'sha256:x',
        },
        {
          path: 'logo.png',
          text: null,
          sizeBytes: 2048,
          binary: true,
          truncated: false,
          hash: 'sha256:y',
        },
      ],
      hash: 'sha256:z',
      modifiedMs: 1_760_000_000_000,
    })
    await openSync({ status: status({ connected: true }), items: [SKILL] })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'View content' }))

    const dialog = await screen.findByRole('dialog')
    await waitFor(() =>
      expect(ipc.readSyncItem).toHaveBeenCalledWith('claude-code', 'skill|pdf#abc'),
    )
    // One file at a time, listed by path, with the text of the first one shown.
    expect(await within(dialog).findAllByText('SKILL.md')).not.toHaveLength(0)
    expect(within(dialog).getByTestId('code-viewer')).toHaveTextContent('# the file body')

    // A binary file is named by its size instead of decoded into nonsense.
    await user.click(within(dialog).getByText('logo.png'))
    expect(
      within(dialog).getByText('A binary file (2.0 KB) — there is no text to show.'),
    ).toBeInTheDocument()
    expect(within(dialog).queryByTestId('code-viewer')).not.toBeInTheDocument()
  })

  it('compares the machine with the cloud, file by file, and restores from there', async () => {
    vi.mocked(ipc.compareSyncItem).mockResolvedValue({
      key: SKILL.key,
      name: SKILL.name,
      label: SKILL.label,
      kind: 'skill',
      ownerId: 'claude-code',
      ownerName: 'Claude Code',
      local: {
        side: 'local',
        key: SKILL.key,
        name: SKILL.name,
        label: SKILL.label,
        ownerId: 'claude-code',
        ownerName: 'Claude Code',
        kind: 'skill',
        isDirectory: true,
        exists: true,
        files: [],
      },
      cloud: {
        side: 'remote',
        key: SKILL.key,
        name: SKILL.name,
        label: SKILL.label,
        ownerId: 'claude-code',
        ownerName: 'Claude Code',
        kind: 'skill',
        isDirectory: true,
        exists: true,
        files: [],
      },
      files: [
        {
          path: 'SKILL.md',
          status: 'changed',
          binary: false,
          localSizeBytes: 14,
          cloudSizeBytes: 28,
          left: '# changed here\n',
          right: '# Agent rules\n\nBe careful.\n',
          truncated: false,
        },
        {
          path: 'notes.md',
          status: 'cloudOnly',
          binary: false,
          cloudSizeBytes: 6,
          right: '# nope\n',
          truncated: false,
        },
      ],
      changed: 2,
      identical: false,
    })
    await openSync({ status: status({ connected: true }), items: [SKILL] })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Compare with the cloud' }))

    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(ipc.compareSyncItem).toHaveBeenCalledWith('gist-1', 'claude-code'))
    // Every file says how it stands, and the summary counts the ones that differ.
    expect(within(dialog).getByText('2 files differ')).toBeInTheDocument()
    expect(within(dialog).getByText('Changed')).toBeInTheDocument()
    expect(within(dialog).getByText('Only in the cloud')).toBeInTheDocument()
    // The selected file is diffed, side by side, with the local text on the left.
    expect(await within(dialog).findByText('# changed here')).toBeInTheDocument()
    expect(within(dialog).getByText('This machine')).toBeInTheDocument()

    // Restoring from the comparison is one reviewed click — the diff is the review.
    await user.click(within(dialog).getByRole('button', { name: 'Restore' }))
    await waitFor(() =>
      expect(ipc.pullSyncItems).toHaveBeenCalledWith(
        [{ remoteId: 'gist-1', ownerId: 'claude-code' }],
        true,
      ),
    )
  })

  it('asks GitHub again from the cloud tab', async () => {
    await openSync({ status: status({ connected: true }), items: [INSTRUCTION], remote: [REMOTE] })
    const user = userEvent.setup()

    await user.click(screen.getByRole('tab', { name: /In the cloud/ }))
    await screen.findByText('AGENTS.md')
    expect(ipc.listRemoteSyncItems).toHaveBeenCalledWith(false)

    vi.mocked(ipc.listRemoteSyncItems).mockClear()
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(ipc.listRemoteSyncItems).toHaveBeenCalledWith(true))
  })

  it('offers the row quick actions on a right click', async () => {
    await openSync({ status: status({ connected: true }), items: [INSTRUCTION] })

    fireEvent.contextMenu(await screen.findByText('AGENTS.md'))

    expect(await screen.findByRole('menuitem', { name: 'Save again' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'View content' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Compare with the cloud' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Copy path' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Show in file manager' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
  })

  it('saves what the user selected', async () => {
    await openSync({ status: status({ connected: true }), items: [INSTRUCTION] })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('checkbox', { name: 'AGENTS.md' }))
    await user.click(screen.getByRole('button', { name: 'Save 1' }))

    await waitFor(() =>
      expect(ipc.pushSyncItems).toHaveBeenCalledWith([
        { ownerId: 'claude-code', itemId: 'instruction|agents.md#abc' },
      ]),
    )
  })
})
