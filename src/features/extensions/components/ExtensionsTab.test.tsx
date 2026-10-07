import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ipc } from '@/shared/api/ipc'
import type { AgentRef } from '@/shared/bindings/AgentRef'
import type { Extension } from '@/shared/bindings/Extension'
import type { InstallPlan } from '@/shared/bindings/InstallPlan'
import { renderWithProviders } from '@/test/render'

import { ExtensionsTab } from './ExtensionsTab'

vi.mock('@/shared/api/ipc', () => ({
  ipc: {
    deleteExtension: vi.fn(),
    setExtensionEnabled: vi.fn(),
    planExtensionAction: vi.fn(),
    runExtensionAction: vi.fn(),
  },
}))

const pi: AgentRef = { id: 'pi', name: 'Pi', icon: 'pi' }

function extension(
  overrides: Partial<Extension> & Pick<Extension, 'id' | 'name' | 'kind'>,
): Extension {
  return {
    surface: 'extensions',
    description: null,
    manager: null,
    source: `builtin:${overrides.name}`,
    path: null,
    entryPath: null,
    version: null,
    author: null,
    homepage: null,
    repository: null,
    license: null,
    enabled: true,
    canUpdate: false,
    canRemove: false,
    canToggle: false,
    scope: { kind: 'global' },
    agent: pi,
    resources: { extensions: 0, skills: 0, prompts: 0, themes: 0 },
    unverified: false,
    modifiedMs: null,
    ...overrides,
  }
}

const packageExtension = extension({
  id: 'package:lens',
  name: 'pi-lens',
  kind: 'package',
  manager: 'npm',
  source: 'npm:pi-lens@4.3.0',
  path: '/home/.pi/agent/npm/node_modules/pi-lens',
  version: '4.3.0',
  description: 'Linters for pi',
  canUpdate: true,
  canRemove: true,
  resources: { extensions: 1, skills: 2, prompts: 0, themes: 0 },
})

const localExtension = extension({
  id: 'local:hello',
  name: 'hello',
  kind: 'local',
  source: '/home/.pi/agent/extensions/hello.ts',
  path: '/home/.pi/agent/extensions/hello.ts',
  entryPath: '/home/.pi/agent/extensions/hello.ts',
  canRemove: true,
  canToggle: true,
})

const builtinExtension = extension({
  id: 'builtin:codemode',
  name: 'codemode',
  kind: 'builtin',
  source: 'builtin:codemode',
})

function renderTab(items: Extension[], supported = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderWithProviders(
    <QueryClientProvider client={client}>
      <ExtensionsTab agentId="pi" extensions={items} supported={supported} />
    </QueryClientProvider>,
  )
}

const plan: InstallPlan = {
  agentId: 'pi',
  agentName: 'Pi',
  action: 'update',
  methodId: 'package:lens',
  manager: 'script',
  program: '/usr/local/bin/pi',
  args: ['update', 'npm:pi-lens@4.3.0'],
  displayCommand: 'pi update npm:pi-lens@4.3.0',
  usesShell: false,
  managerAvailable: true,
  warnings: [],
  targetOs: 'linux',
}

describe('ExtensionsTab', () => {
  afterEach(cleanup)

  it('shows the packages the agent tracks, and hides what it ships or was handed', async () => {
    const user = userEvent.setup()
    const { container } = renderTab([packageExtension, localExtension, builtinExtension])

    // The list opens on what the user installed: a wall of modules nobody asked for is a wall
    // nobody reads.
    expect(within(container).getByRole('button', { name: 'pi-lens' })).toBeTruthy()
    expect(within(container).queryByRole('button', { name: 'hello' })).toBeNull()
    expect(within(container).queryByRole('button', { name: 'codemode' })).toBeNull()

    // They are behind the type filter, not gone — the chips say so with their counts.
    const kinds = within(container).getByRole('group', { name: 'Type' })
    expect(within(kinds).getByRole('button', { name: 'Package 1' })).toBeTruthy()
    expect(within(kinds).getByRole('button', { name: 'Local 1' })).toBeTruthy()
    expect(within(kinds).getByRole('button', { name: 'Built-in 1' })).toBeTruthy()

    await user.click(within(kinds).getByRole('button', { name: 'Local 1' }))
    expect(within(container).getByRole('button', { name: 'hello' })).toBeTruthy()
    expect(within(container).queryByRole('button', { name: 'codemode' })).toBeNull()
  })

  it('always offers a way out of a filter that hides everything', async () => {
    const user = userEvent.setup()
    const { container } = renderTab([packageExtension])

    const kinds = within(container).getByRole('group', { name: 'Type' })
    await user.click(within(kinds).getByRole('button', { name: 'Package 1' }))

    expect(within(container).getByText('Nothing matches the current filters')).toBeTruthy()

    await user.click(within(container).getByRole('button', { name: 'Show everything' }))
    expect(within(container).getByRole('button', { name: 'pi-lens' })).toBeTruthy()
  })

  it('offers each row only the actions the backend says are possible', async () => {
    const user = userEvent.setup()
    const { container } = renderTab([packageExtension, localExtension, builtinExtension])
    const kinds = within(container).getByRole('group', { name: 'Type' })
    await user.click(within(kinds).getByRole('button', { name: 'Local 1' }))
    await user.click(within(kinds).getByRole('button', { name: 'Built-in 1' }))

    // The three origins render through one card, told apart by their kind badge (the filter
    // chips carry the same words, so each badge is read inside its own row).
    const row = (name: string) => within(within(container).getByRole('button', { name }))
    expect(row('pi-lens').getByText('Package')).toBeTruthy()
    expect(row('hello').getByText('Local')).toBeTruthy()
    expect(row('codemode').getByText('Built-in')).toBeTruthy()
    expect(within(container).getByText('4.3.0')).toBeTruthy()
    expect(within(container).getByText('1 extension · 2 skills')).toBeTruthy()

    // Update is a package thing, the switch is a local thing, and a built-in has neither.
    expect(within(container).getAllByRole('button', { name: 'Update' }).length).toBe(1)
    expect(within(container).getAllByRole('switch').length).toBe(1)
    // Remove covers the package (through its CLI) and the local module (to the trash).
    expect(within(container).getAllByRole('button', { name: 'Remove' }).length).toBe(2)
  })

  it('says an agent without an extensions surface has none', () => {
    const { container } = renderTab([], false)
    expect(within(container).getByText('This agent has no extensions')).toBeTruthy()
  })

  it('points at how extensions get installed when there are none', () => {
    const { container } = renderTab([])
    expect(within(container).getByText('No extensions installed')).toBeTruthy()
  })

  it('switches a local module off through the backend', async () => {
    const user = userEvent.setup()
    vi.mocked(ipc.setExtensionEnabled).mockResolvedValue({
      data: { extensionId: 'local:hello', name: 'hello', enabled: false, path: '/x' },
      report: {} as never,
    })
    const { container } = renderTab([localExtension])
    await user.click(within(container).getByRole('button', { name: 'Local 1' }))

    await user.click(within(container).getByRole('switch', { name: 'Switch off' }))

    await waitFor(() =>
      expect(ipc.setExtensionEnabled).toHaveBeenCalledWith('pi', 'local:hello', false),
    )
  })

  it('shows the resolved command before a package is updated', async () => {
    const user = userEvent.setup()
    vi.mocked(ipc.planExtensionAction).mockResolvedValue(plan)
    renderTab([packageExtension])

    await user.click(screen.getByRole('button', { name: 'Update' }))

    await waitFor(() =>
      expect(ipc.planExtensionAction).toHaveBeenCalledWith('pi', 'package:lens', 'update'),
    )
    expect(await screen.findByText('pi update npm:pi-lens@4.3.0')).toBeTruthy()
  })
})
