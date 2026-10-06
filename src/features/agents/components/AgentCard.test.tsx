import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'

import { ipc } from '@/shared/api/ipc'
import type { Agent } from '@/shared/bindings/Agent'
import { renderWithProviders } from '@/test/render'

import { AgentCard } from './AgentCard'

vi.mock('@/shared/api/ipc', () => ({
  ipc: {
    openUrl: vi.fn().mockResolvedValue(undefined),
    revealPath: vi.fn().mockResolvedValue(undefined),
  },
}))

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'claude-code',
    name: 'Claude Code',
    description: 'Anthropic terminal agent',
    tagline: null,
    icon: null,
    category: 'cli',
    website: 'https://claude.com/claude-code',
    docs: 'https://code.claude.com/docs',
    features: [],
    popular: true,
    status: 'installed',
    binaryPath: '/usr/local/bin/claude',
    foundIn: 'path',
    version: {
      raw: '2.1.211',
      major: 2,
      minor: 1,
      patch: 211,
      comparable: true,
    },
    installedVia: 'npm',
    installOptions: [],
    canInstall: false,
    installDocsUrl: null,
    canUpdate: true,
    canUninstall: false,
    configs: [],
    facts: [],
    skills: [],
    mcpServers: [],
    other: [],
    update: null,
    unverified: [],
    notes: null,
    manifestSource: { kind: 'builtin' },
    removal: 'hidden',
    warnings: [],
    scanMs: 12,
    ...overrides,
  }
}

describe('AgentCard', () => {
  it('shows the installed version and the update badge', () => {
    renderWithProviders(
      <AgentCard
        agent={agent({
          update: { latest: '2.2.0', source: 'npm', checkedAtMs: 1 },
        })}
        onInstall={() => undefined}
      />,
    )

    expect(screen.getByRole('link', { name: 'Claude Code' })).toBeInTheDocument()
    expect(screen.getByText('2.1.211')).toBeInTheDocument()
    expect(screen.getByText('Update available')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled()
  })

  it('offers installation only when an install method is available', async () => {
    const onInstall = vi.fn()
    const withoutManager = renderWithProviders(
      <AgentCard
        agent={agent({
          status: 'notInstalled',
          version: null,
          canInstall: false,
          canUpdate: false,
          installedVia: null,
          installDocsUrl: 'https://code.claude.com/docs/en/setup',
        })}
        onInstall={onInstall}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument()
    expect(screen.getByText('Official instructions')).toBeInTheDocument()
    withoutManager.unmount()

    renderWithProviders(
      <AgentCard
        agent={agent({ status: 'notInstalled', version: null, canInstall: true, canUpdate: false })}
        onInstall={onInstall}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Install' }))
    expect(onInstall).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'claude-code' }),
      'install',
    )
  })

  it('marks manifests that still need a docs check', () => {
    renderWithProviders(
      <AgentCard agent={agent({ unverified: ['skills.path'] })} onInstall={() => undefined} />,
    )
    expect(screen.getByText('Needs verification')).toBeInTheDocument()
  })

  it('surfaces scan warnings as a count', () => {
    renderWithProviders(
      <AgentCard
        agent={agent({ warnings: ['mcp servers: invalid JSON'] })}
        onInstall={() => undefined}
      />,
    )
    expect(screen.getByText('1 warning')).toBeInTheDocument()
  })

  it('shows how many skills, MCP servers, configs and resources the agent has', () => {
    renderWithProviders(
      <AgentCard
        agent={agent({
          skills: [{}, {}] as Agent['skills'],
          mcpServers: [{}] as Agent['mcpServers'],
          configs: [{}, {}, {}] as Agent['configs'],
          other: [{}] as Agent['other'],
        })}
        onInstall={() => undefined}
      />,
    )

    expect(screen.getByText('2 skills')).toBeInTheDocument()
    expect(screen.getByText('1 MCP server')).toBeInTheDocument()
    expect(screen.getByText('3 configs')).toBeInTheDocument()
    expect(screen.getByText('1 resource')).toBeInTheDocument()
  })

  it('hides the resource counts when the agent has none', () => {
    renderWithProviders(<AgentCard agent={agent()} onInstall={() => undefined} />)

    expect(screen.queryByText('0 skills')).not.toBeInTheDocument()
    expect(screen.queryByText('0 configs')).not.toBeInTheDocument()
  })

  it('offers removal only when the page wires a handler', async () => {
    const onRemove = vi.fn()
    const withRemove = renderWithProviders(
      <AgentCard agent={agent()} onInstall={() => undefined} onRemove={onRemove} />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ id: 'claude-code' }))
    withRemove.unmount()

    renderWithProviders(<AgentCard agent={agent()} onInstall={() => undefined} />)
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
  })

  it('offers a favourite star only when the page wires a handler', async () => {
    const onToggleFavorite = vi.fn()
    const pinned = renderWithProviders(
      <AgentCard
        agent={agent()}
        onInstall={() => undefined}
        favorite
        onToggleFavorite={onToggleFavorite}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Remove from favorites' }))
    expect(onToggleFavorite).toHaveBeenCalledWith(expect.objectContaining({ id: 'claude-code' }))
    pinned.unmount()

    const unpinned = renderWithProviders(
      <AgentCard agent={agent()} onInstall={() => undefined} onToggleFavorite={onToggleFavorite} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Add to favorites' }))
    expect(onToggleFavorite).toHaveBeenCalledTimes(2)
    unpinned.unmount()

    renderWithProviders(<AgentCard agent={agent()} onInstall={() => undefined} />)
    expect(screen.queryByRole('button', { name: 'Add to favorites' })).not.toBeInTheDocument()
  })

  it('opens the agent page when the info area is clicked', async () => {
    const { container } = renderWithProviders(
      <Routes>
        <Route path="/" element={<AgentCard agent={agent()} onInstall={() => undefined} />} />
        <Route path="/agents/:agentId" element={<h1>Agent page</h1>} />
      </Routes>,
    )

    await userEvent.click(within(container).getByText('Anthropic terminal agent'))

    expect(screen.getByRole('heading', { name: 'Agent page' })).toBeInTheDocument()
  })
})

describe('AgentCard context menu', () => {
  /** Right click the card's description — the widest hit area outside the link's buttons. */
  const openMenu = async (container: HTMLElement) => {
    fireEvent.contextMenu(within(container).getByText('Anthropic terminal agent'), {
      clientX: 40,
      clientY: 60,
    })
    return within(await screen.findByRole('menu'))
  }

  it('holds every action and stays closed until the card is right-clicked', async () => {
    const view = renderWithProviders(
      <AgentCard
        agent={agent({ update: { latest: '2.2.0', source: 'npm', checkedAtMs: 1 } })}
        onInstall={() => undefined}
        onRemove={() => undefined}
      />,
    )

    expect(screen.queryByRole('menu')).toBeNull()

    const menu = await openMenu(view.container)

    for (const name of [
      'Open details',
      'Website',
      'Docs',
      'Copy path',
      'Show in file manager',
      'Update to 2.2.0',
      'Remove',
    ]) {
      expect(menu.getByRole('menuitem', { name })).toBeTruthy()
    }

    view.unmount()
  })

  it('navigates to the agent page', async () => {
    // A distinct heading: the test above leaves its own "Agent page" in the DOM, and RTL does
    // not clean up between `it` blocks in this suite.
    const view = renderWithProviders(
      <Routes>
        <Route path="/" element={<AgentCard agent={agent()} onInstall={() => undefined} />} />
        <Route path="/agents/:agentId" element={<h1>Agent details</h1>} />
      </Routes>,
    )

    fireEvent.click(
      (await openMenu(view.container)).getByRole('menuitem', { name: 'Open details' }),
    )
    expect(await screen.findByRole('heading', { name: 'Agent details' })).toBeInTheDocument()
    view.unmount()
  })

  it('runs the install action and the removal the page wired', async () => {
    const onInstall = vi.fn()
    const onRemove = vi.fn()
    const view = renderWithProviders(
      <AgentCard agent={agent()} onInstall={onInstall} onRemove={onRemove} />,
    )

    const menu = await openMenu(view.container)
    fireEvent.click(menu.getByRole('menuitem', { name: 'Update' }))
    expect(onInstall).toHaveBeenCalledWith(expect.objectContaining({ id: 'claude-code' }), 'update')

    const reopened = await openMenu(view.container)
    fireEvent.click(reopened.getByRole('menuitem', { name: 'Remove' }))
    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ id: 'claude-code' }))

    view.unmount()
  })

  it('copies the binary path and shows it in the file manager', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const view = renderWithProviders(<AgentCard agent={agent()} onInstall={() => undefined} />)

    fireEvent.click((await openMenu(view.container)).getByRole('menuitem', { name: 'Copy path' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('/usr/local/bin/claude'))

    const reopened = await openMenu(view.container)
    fireEvent.click(reopened.getByRole('menuitem', { name: 'Show in file manager' }))
    expect(vi.mocked(ipc.revealPath)).toHaveBeenCalledWith('/usr/local/bin/claude')

    view.unmount()
  })

  it('drops the path, update and removal entries that cannot run', async () => {
    const view = renderWithProviders(
      <AgentCard
        agent={agent({
          status: 'notInstalled',
          binaryPath: null,
          version: null,
          installedVia: null,
          canInstall: true,
          canUpdate: false,
        })}
        onInstall={() => undefined}
      />,
    )

    const menu = await openMenu(view.container)

    expect(menu.getByRole('menuitem', { name: 'Install' })).toBeTruthy()
    expect(menu.queryByRole('menuitem', { name: 'Copy path' })).toBeNull()
    expect(menu.queryByRole('menuitem', { name: 'Show in file manager' })).toBeNull()
    expect(menu.queryByRole('menuitem', { name: 'Remove' })).toBeNull()

    view.unmount()
  })
})
