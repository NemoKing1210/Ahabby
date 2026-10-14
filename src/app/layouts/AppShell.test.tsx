import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ipc } from '@/shared/api/ipc'
import { queryKeys } from '@/shared/api/keys'
import type { ScanReport } from '@/shared/bindings/ScanReport'
import type { Settings } from '@/shared/bindings/Settings'
import { initI18n } from '@/shared/i18n'
import { TooltipProvider } from '@/shared/ui/Tooltip'

import { ScanRefreshProvider } from '@/features/agents/api/scan'
import {
  useTerminalStore,
  type TerminalSessionState,
  type TerminalWorkspace,
} from '@/features/terminal/store'

import { AppShell } from './AppShell'
import { testSettings } from '@/test/fixtures'

/** The dock itself is a heavy lazy component with its own file; what the shell owes it is the window. */
vi.mock('@/features/terminal/components/TerminalDock', () => ({
  TerminalDock: () => <div data-testid="dock" />,
}))

vi.mock('@/shared/api/ipc', () => ({
  ipc: {
    getSettings: vi.fn(),
    setSidebarCollapsed: vi.fn(),
    setLastRoute: vi.fn(),
    setTourCompleted: vi.fn(),
    cachedAgents: vi.fn(),
    listAgents: vi.fn(),
    listLibrary: vi.fn(),
    listTerminals: vi.fn(),
    windowChrome: vi.fn(),
  },
}))

/** The event bridge is not what this file is about; the shell works without it. */
vi.mock('@tauri-apps/api/event', () => ({
  listen: () => Promise.resolve(() => undefined),
}))

const REPORT: ScanReport = {
  agents: [],
  problems: [],
  scannedAtMs: 0,
  durationMs: 0,
  installed: 0,
  availableToInstall: 0,
  os: 'windows',
  shared: { configs: [], skills: [], mcpServers: [], other: [], roots: [] },
  projects: { folders: [], projects: [], scannedAtMs: 0, durationMs: 0 },
}

/** One open session, and the workspace showing it — all the shell needs to have a dock to lay out. */
const TERMINAL: TerminalSessionState = {
  sessionId: 'term-1',
  agentId: 'claude-code',
  agentName: 'Claude Code',
  cwd: '/work/ahabby',
  shell: 'pwsh',
  command: 'claude',
  running: true,
  exitCode: null,
  startedAtMs: 0,
}

const WORKSPACE: TerminalWorkspace = {
  id: 'w1',
  layout: 'single',
  panes: [{ id: 'p1', sessionId: 'term-1' }],
  activePaneId: 'p1',
  sizes: { x: 0.5, y: 0.5 },
}

/** A second workspace, split in two, so the rail's count has something to count. */
const SPLIT: TerminalWorkspace = {
  id: 'w2',
  layout: 'columns',
  panes: [
    { id: 'p2', sessionId: 'term-2' },
    { id: 'p3', sessionId: null },
  ],
  activePaneId: 'p2',
  sizes: { x: 0.5, y: 0.5 },
}

const CODEX: TerminalSessionState = {
  ...TERMINAL,
  sessionId: 'term-2',
  agentId: 'codex',
  agentName: 'Codex',
}

/** The shared settings fixture, under the name the cases below use. */
const settings = testSettings

/**
 * Mounts the shell the way `boot()` does: the settings query is primed before the first render,
 * and only the commands the shell actually calls are mocked. What is asserted here is the pair of
 * remembered values — the rail and the open screen — from the click to the write.
 */
function renderShell(stored = settings(), route = '/agents', customChrome = false) {
  vi.mocked(ipc.cachedAgents).mockResolvedValue(null)
  vi.mocked(ipc.listAgents).mockResolvedValue(REPORT)
  vi.mocked(ipc.listLibrary).mockResolvedValue({
    skills: [],
    mcpServers: [],
    other: [],
    stats: { agents: 0, installedAgents: 0, skills: 0, mcpServers: 0, other: 0 },
    scannedAtMs: 0,
    problems: [],
  })
  vi.mocked(ipc.listTerminals).mockResolvedValue({ options: [], defaultCwd: '/home' })
  vi.mocked(ipc.setSidebarCollapsed).mockImplementation((collapsed: boolean) =>
    Promise.resolve(settings({ ...stored, sidebarCollapsed: collapsed })),
  )
  vi.mocked(ipc.setLastRoute).mockImplementation((last: string | null) =>
    Promise.resolve(settings({ ...stored, lastRoute: last })),
  )

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(queryKeys.settings(), stored)
  client.setQueryData(queryKeys.agents(), REPORT)
  // A window the OS frames by default — what the shell looks like on macOS and Linux, where the
  // header is never drawn — so the tests below see the shell alone.
  client.setQueryData(queryKeys.windowChrome(), {
    custom: customChrome,
    maximized: false,
    focused: true,
  })

  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <AppShell />,
        children: [
          { path: 'agents', element: <p>agents screen</p> },
          { path: 'library', element: <p>library screen</p> },
        ],
      },
    ],
    { initialEntries: [route] },
  )

  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={initI18n('en')}>
        <TooltipProvider>
          <ScanRefreshProvider>
            <RouterProvider router={router} />
          </ScanRefreshProvider>
        </TooltipProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  )

  return client
}

afterEach(() => {
  // The open terminals are the window's state and outlive a case, so the next one starts with an
  // empty dock rather than whichever workspaces the last case left behind.
  useTerminalStore.setState({
    sessions: {},
    workspaces: [],
    activeId: null,
    expanded: false,
    maximized: false,
    buffered: {},
    exits: {},
  })
  cleanup()
})

describe('AppShell', () => {
  it('opens the rail the way it was left', async () => {
    renderShell(settings({ sidebarCollapsed: true }))

    expect(await screen.findByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Navigation' })).toBeNull()
  })

  it('moves the rail on the click and remembers it, before the write lands', async () => {
    // The write is held open: everything asserted below happens while it is still in flight.
    let release: (saved: Settings) => void = () => undefined
    const client = renderShell()
    vi.mocked(ipc.setSidebarCollapsed).mockImplementation(
      () => new Promise<Settings>((resolve) => (release = resolve)),
    )
    await screen.findByRole('heading', { name: 'Navigation' })

    await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))

    expect(await screen.findByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
    expect(client.getQueryData<Settings>(queryKeys.settings())?.sidebarCollapsed).toBe(true)
    expect(ipc.setSidebarCollapsed).toHaveBeenCalledWith(true)

    await act(async () => {
      release(settings({ sidebarCollapsed: true }))
      await Promise.resolve()
    })
  })

  it('puts the rail back where it was when the write fails', async () => {
    vi.mocked(ipc.setSidebarCollapsed).mockRejectedValue(new Error('settings.json is read-only'))
    const client = renderShell()
    await screen.findByRole('heading', { name: 'Navigation' })

    await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument(),
    )
    expect(client.getQueryData<Settings>(queryKeys.settings())?.sidebarCollapsed).toBe(false)
  })

  it('remembers the screen the window is on', async () => {
    const client = renderShell(settings({ lastRoute: '/agents' }), '/library')

    await waitFor(() => expect(ipc.setLastRoute).toHaveBeenCalledWith('/library'))
    expect(client.getQueryData<Settings>(queryKeys.settings())?.lastRoute).toBe('/library')
  })

  it('does not write the screen it already remembers', async () => {
    renderShell(settings({ lastRoute: '/agents' }), '/agents')

    expect(await screen.findByText('agents screen')).toBeInTheDocument()
    expect(ipc.setLastRoute).not.toHaveBeenCalled()
  })

  it('mounts the screen that was asked for instead of waiting for the last one to leave', async () => {
    renderShell(settings(), '/agents')
    await screen.findByText('agents screen')

    fireEvent.click(screen.getByRole('link', { name: 'Library' }))

    // The incoming screen is on screen with the click, and the outgoing one is not kept around to
    // animate out: an exit in front of the new screen is the window answering the click a fifth of
    // a second later, and every query the new screen starts waits behind it.
    expect(screen.getByText('library screen')).toBeInTheDocument()
    expect(screen.queryByText('agents screen')).toBeNull()
  })

  it('keeps the rail as tall as the window, with the header beside it', () => {
    renderShell(settings(), '/agents', true)

    const rail = screen.getByRole('complementary')
    const header = screen.getByRole('banner')

    // The header is not above the rail but beside it — the rail runs the window's full height,
    // from one 12px inset to the other, and the bar is the top row of the column to its right.
    expect(rail.contains(header)).toBe(false)
    expect(rail.parentElement?.contains(header)).toBe(true)
    expect(header.parentElement).toBe(screen.getByRole('main').parentElement)
  })

  it('draws no header where the OS frames the window', () => {
    renderShell(settings(), '/agents', false)

    expect(screen.queryByRole('banner')).toBeNull()
    expect(
      screen.getByRole('complementary').parentElement?.contains(screen.getByRole('main')),
    ).toBe(true)
  })

  it('stands the screen and the rail down for a maximized terminal', async () => {
    renderShell()
    await screen.findByText('agents screen')
    const page = screen.getByRole('main')
    const rail = screen.getByRole('complementary')

    act(() => {
      useTerminalStore.setState({
        sessions: { 'term-1': TERMINAL },
        workspaces: [WORKSPACE],
        activeId: 'w1',
        expanded: true,
        maximized: true,
      })
    })

    expect(await screen.findByTestId('dock')).toBeInTheDocument()
    expect(page).toHaveClass('hidden')
    expect(rail).toHaveClass('hidden')

    act(() => {
      useTerminalStore.setState({ maximized: false })
    })

    // Hidden, never unmounted: the screen that was covered comes back as the same element, with
    // the scroll position and the answers its queries already had.
    expect(screen.getByRole('main')).toBe(page)
    expect(page).not.toHaveClass('hidden')
    expect(rail).not.toHaveClass('hidden')
  })

  it('counts the workspaces the rail can open, not the panes inside them', async () => {
    renderShell()
    await screen.findByText('agents screen')

    act(() => {
      useTerminalStore.setState({
        sessions: { 'term-1': TERMINAL, 'term-2': CODEX },
        workspaces: [WORKSPACE, SPLIT],
        activeId: 'w1',
        expanded: true,
      })
    })

    // Two tabs hold three panes between them; the rail counts what it can take the window to, and
    // each row says for itself how many agents are behind it.
    const entry = screen.getByRole('button', { name: /^Terminal/ })
    expect(within(entry).getByText('2')).toBeInTheDocument()
  })
})
