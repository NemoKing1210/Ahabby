import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ipc } from '@/shared/api/ipc'
import type { AgentRef } from '@/shared/bindings/AgentRef'
import type { ConfigFile } from '@/shared/bindings/ConfigFile'
import type { McpServer } from '@/shared/bindings/McpServer'
import type { RemoteItem } from '@/shared/bindings/RemoteItem'
import type { SyncStatus } from '@/shared/bindings/SyncStatus'
import { resetSessionState } from '@/shared/lib/sessionState'
import { renderWithProviders } from '@/test/render'
import { emptyScanReport } from '@/test/fixtures'

import { CloudActionsProvider } from '@/features/sync/components/CloudActions'

import { McpTab } from './McpTab'

vi.mock('@/shared/api/ipc', () => ({
  ipc: {
    deleteMcpServer: vi.fn(),
    setMcpServerEnabled: vi.fn(),
    syncStatus: vi.fn(),
    listSyncItems: vi.fn(),
    listRemoteSyncItems: vi.fn(),
  },
}))

/** CodeMirror is replaced by a pre — what this file is about is what the detail view reads out. */
vi.mock('@/shared/ui/CodeViewer', () => ({
  CodeViewer: ({ value }: { value: string }) => <pre>{value}</pre>,
}))

/**
 * What the editor dialog was handed. The dialog itself is a CodeMirror surface with its own
 * tests, so the tab's contract with it is the document it resolves for the server.
 */
const editor = vi.hoisted(() => ({
  opened: null as { agentId: string; path: string; editable: boolean } | null,
}))

vi.mock('@/features/editor/components/DocumentEditorDialog', () => ({
  DocumentEditorDialog: (props: {
    agentId: string
    document: { path: string; editable: boolean }
  }) => {
    editor.opened = {
      agentId: props.agentId,
      path: props.document.path,
      editable: props.document.editable,
    }
    return null
  },
}))

const claude: AgentRef = { id: 'claude-code', name: 'Claude Code', icon: 'claude' }

const CONFIG_PATH = '/home/u/.claude.json'

function server(overrides: Partial<McpServer> & Pick<McpServer, 'id' | 'name'>): McpServer {
  return {
    transport: { type: 'stdio', command: 'npx', args: ['-y', 'server-github'] },
    scope: { kind: 'global' },
    agent: claude,
    sourceConfig: CONFIG_PATH,
    keyPath: ['mcpServers', overrides.name],
    env: [],
    headers: [],
    raw: '{}',
    createdMs: null,
    modifiedMs: null,
    hasSecrets: false,
    enabled: true,
    removable: true,
    unverified: false,
    ...overrides,
  }
}

function config(overrides: Partial<ConfigFile> & Pick<ConfigFile, 'id'>): ConfigFile {
  return {
    label: '.claude.json',
    description: null,
    path: CONFIG_PATH,
    format: 'json',
    scope: { kind: 'global' },
    agent: claude,
    exists: true,
    sizeBytes: 120,
    modifiedMs: null,
    editable: true,
    ...overrides,
  }
}

function renderTab({
  servers = [],
  configs = [],
  owner,
  cloud = false,
}: {
  servers?: McpServer[]
  configs?: ConfigFile[]
  owner?: AgentRef | null
  /** Mount the cloud surface around the tab, as the agent page does. */
  cloud?: boolean
} = {}) {
  const tab = <McpTab agentId={claude.id} servers={servers} configs={configs} owner={owner} />
  return renderWithProviders(
    cloud ? <CloudActionsProvider owner={claude}>{tab}</CloudActionsProvider> : tab,
  )
}

const CONNECTED: SyncStatus = {
  provider: 'gist',
  enabled: true,
  mode: 'manual',
  connected: true,
  tokenHint: 'ghp_…',
  running: false,
}

const CLOUD_COPY: RemoteItem = {
  remoteId: 'gist-4',
  key: 'mcp|/home/u/.mcp.json',
  ownerId: claude.id,
  ownerName: claude.name,
  ownerKind: 'agent',
  kind: 'mcp',
  name: 'mcp',
  label: 'team-mcp.json',
  relativePath: '~/.mcp.json',
  isDirectory: false,
  files: 1,
  sizeBytes: 20,
  hash: 'sha256:x',
  description: '[Ahabby] mcp|/home/u/.mcp.json',
  uri: 'https://gist.github.com/gist-4',
  updatedAtMs: 1_760_000_000_000,
  hasSecrets: false,
}

beforeEach(() => {
  vi.mocked(ipc.syncStatus).mockResolvedValue(CONNECTED)
  vi.mocked(ipc.listSyncItems).mockResolvedValue({
    items: [],
    unsynced: 0,
    modified: 0,
    missing: 0,
  })
  vi.mocked(ipc.listRemoteSyncItems).mockResolvedValue({
    items: [],
    fetchedAtMs: 1,
    fromCache: false,
  })
})

afterEach(() => {
  cleanup()
  resetSessionState()
  editor.opened = null
  vi.clearAllMocks()
})

describe('McpTab', () => {
  it('says an agent with no server and no way to add one holds nothing', () => {
    const { container } = renderTab({ owner: null })

    expect(within(container).getByText('No MCP servers configured')).toBeTruthy()
    expect(
      within(container).getByText(
        "Add servers with the agent's own CLI, or edit its config file here.",
      ),
    ).toBeTruthy()
    // No owner, no manifest to write into: there is no creation to offer.
    expect(within(container).queryByRole('button', { name: 'New server' })).toBeNull()
  })

  it('offers to add one when the agent can hold it', () => {
    const { container } = renderTab({ owner: claude })

    expect(
      within(container).getByText(
        "Add a server of your own, or configure one with the agent's CLI.",
      ),
    ).toBeTruthy()
    expect(within(container).getByRole('button', { name: 'New server' })).toBeTruthy()
  })

  it('leaves the create button out when no owner is given', () => {
    const { container } = renderTab({ servers: [server({ id: 'srv-1', name: 'github' })] })

    expect(within(container).queryByRole('button', { name: 'New server' })).toBeNull()
  })

  it('shows the cloud copies this machine has no file for, and only those', async () => {
    vi.mocked(ipc.listRemoteSyncItems).mockResolvedValue({
      items: [CLOUD_COPY, { ...CLOUD_COPY, kind: 'skill', remoteId: 'gist-5', label: 'pdf' }],
      fetchedAtMs: 1,
      fromCache: false,
    })
    const { container } = renderTab({ cloud: true })

    // A copy in the cloud is not "nothing configured": the empty state has to step aside.
    expect(await within(container).findByText('team-mcp.json')).toBeTruthy()
    expect(within(container).queryByText('No MCP servers configured')).toBeNull()
    expect(within(container).getByText('Not on this machine')).toBeTruthy()
    // An MCP tab lists MCP config files: a skill the cloud holds belongs to its own tab.
    expect(within(container).queryByText('pdf')).toBeNull()
  })

  it('narrows the list to the servers that are switched off', async () => {
    const user = userEvent.setup()
    const { container } = renderTab({
      servers: [
        server({ id: 'srv-on', name: 'github' }),
        server({ id: 'srv-off', name: 'linear', enabled: false }),
      ],
    })

    const activity = within(container).getByRole('group', { name: 'Activity' })
    expect(within(activity).getByRole('button', { name: 'All 2' })).toBeTruthy()

    await user.click(within(activity).getByRole('button', { name: 'Off 1' }))

    expect(within(container).getByText('linear')).toBeTruthy()
    // Rows leave through their own exit animation (see `AnimatedList`), never instantly.
    await waitFor(() => expect(within(container).queryByText('github')).toBeNull())
  })

  it('remembers the filter a session chose', async () => {
    const user = userEvent.setup()
    const servers = [
      server({ id: 'srv-on', name: 'github' }),
      server({ id: 'srv-off', name: 'linear', enabled: false }),
    ]
    const first = renderTab({ servers })

    await user.click(within(first.container).getByRole('button', { name: 'Off 1' }))
    await waitFor(() => expect(within(first.container).queryByText('github')).toBeNull())
    first.unmount()

    // Leaving the tab unmounts it; coming back is the same session, so the filter is still on.
    const second = renderTab({ servers })
    const activity = within(second.container).getByRole('group', { name: 'Activity' })
    expect(
      within(activity).getByRole('button', { name: 'Off 1' }).getAttribute('aria-pressed'),
    ).toBe('true')
    expect(within(second.container).getByText('linear')).toBeTruthy()
    expect(within(second.container).queryByText('github')).toBeNull()
    second.unmount()

    // The filter lives under `mcp.activity` and nowhere else: forgetting that key starts clean.
    resetSessionState('mcp.activity')
    const third = renderTab({ servers })
    const cleared = within(third.container).getByRole('group', { name: 'Activity' })
    expect(
      within(cleared).getByRole('button', { name: 'All 2' }).getAttribute('aria-pressed'),
    ).toBe('true')
    expect(within(third.container).getByText('github')).toBeTruthy()
  })

  it('says a filter with nothing behind it is empty', async () => {
    const user = userEvent.setup()
    const { container } = renderTab({ servers: [server({ id: 'srv-on', name: 'github' })] })

    await user.click(within(container).getByRole('button', { name: 'Off 0' }))

    expect(within(container).getByText('Nothing here is switched off')).toBeTruthy()
    expect(within(container).queryByText('github')).toBeNull()
  })

  it('opens the create dialog when an owner can hold a new server', async () => {
    const user = userEvent.setup()
    const { container } = renderTab({ owner: claude })

    await user.click(within(container).getByRole('button', { name: 'New server' }))

    expect(await screen.findByText('Add an MCP server')).toBeTruthy()
  })

  it('asks before removing a server, and removes it only then', async () => {
    const user = userEvent.setup()
    vi.mocked(ipc.deleteMcpServer).mockResolvedValue({
      data: { removedServerId: 'srv-1', name: 'github', config: CONFIG_PATH },
      report: emptyScanReport,
    })
    const target = server({ id: 'srv-1', name: 'github' })
    const { container } = renderTab({ servers: [target] })

    await user.click(within(container).getByRole('button', { name: 'Remove server' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Remove “github”?')).toBeTruthy()
    // Opening the confirmation is not a removal: the backend is asked only on the second click.
    expect(ipc.deleteMcpServer).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Remove server' }))

    await waitFor(() => expect(ipc.deleteMcpServer).toHaveBeenCalledWith(claude.id, 'srv-1', true))
  })

  it('removes nothing when the confirmation is dismissed', async () => {
    const user = userEvent.setup()
    const { container } = renderTab({ servers: [server({ id: 'srv-1', name: 'github' })] })

    await user.click(within(container).getByRole('button', { name: 'Remove server' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(ipc.deleteMcpServer).not.toHaveBeenCalled()
  })

  it('switches a server off through the backend', async () => {
    const user = userEvent.setup()
    vi.mocked(ipc.setMcpServerEnabled).mockResolvedValue({
      data: { serverId: 'srv-1', name: 'github', enabled: false, config: CONFIG_PATH },
      report: emptyScanReport,
    })
    const { container } = renderTab({ servers: [server({ id: 'srv-1', name: 'github' })] })

    await user.click(within(container).getByRole('switch', { name: 'Switch off' }))

    await waitFor(() =>
      expect(ipc.setMcpServerEnabled).toHaveBeenCalledWith(claude.id, 'srv-1', false),
    )
  })

  it('hands the editor the config file a server lives in', async () => {
    const user = userEvent.setup()
    const { container } = renderTab({
      servers: [server({ id: 'srv-1', name: 'github' })],
      configs: [config({ id: 'cfg-1' })],
    })

    await user.click(within(container).getByRole('button', { name: 'Open config file' }))

    expect(editor.opened).toEqual({ agentId: claude.id, path: CONFIG_PATH, editable: true })
  })

  it('opens a file the manifest owns read-only', async () => {
    const user = userEvent.setup()
    const { container } = renderTab({
      servers: [server({ id: 'srv-1', name: 'github' })],
      configs: [config({ id: 'cfg-1', editable: false })],
    })

    // A file Ahabby may not write offers to be read, and gets no textarea in the editor.
    await user.click(within(container).getByRole('button', { name: 'View' }))

    expect(editor.opened).toEqual({ agentId: claude.id, path: CONFIG_PATH, editable: false })
  })

  it('opens a server’s detail view from its card, switch and all', async () => {
    const user = userEvent.setup()
    vi.mocked(ipc.setMcpServerEnabled).mockResolvedValue({
      data: { serverId: 'srv-1', name: 'github', enabled: false, config: CONFIG_PATH },
      report: emptyScanReport,
    })
    const { container } = renderTab({
      servers: [server({ id: 'srv-1', name: 'github' })],
      configs: [config({ id: 'cfg-1' })],
    })

    await user.click(within(container).getByRole('button', { name: 'github' }))

    const detail = within(await screen.findByRole('dialog'))
    // What the card has no room for: the arguments, the position in the file, the JSON itself.
    expect(detail.getByText('-y server-github')).toBeTruthy()
    expect(detail.getByText('mcpServers.github')).toBeTruthy()
    // The brand mark ships an SVG `<title>` with the agent name, which is not the visible label.
    expect(detail.getByText('Claude Code', { ignore: 'script, style, title' })).toBeTruthy()

    // The dialog's switch is the card's switch: the very same backend call.
    await user.click(detail.getByRole('switch', { name: 'Switch off' }))
    await waitFor(() =>
      expect(ipc.setMcpServerEnabled).toHaveBeenCalledWith(claude.id, 'srv-1', false),
    )
  })

  it('asks before removing a server from its detail view', async () => {
    const user = userEvent.setup()
    const { container } = renderTab({ servers: [server({ id: 'srv-1', name: 'github' })] })

    await user.click(within(container).getByRole('button', { name: 'github' }))
    const detail = within(await screen.findByRole('dialog'))

    await user.click(detail.getByRole('button', { name: 'Remove server' }))

    expect(await screen.findByText('Remove “github”?')).toBeTruthy()
    expect(ipc.deleteMcpServer).not.toHaveBeenCalled()
  })
})
