import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'

import type { McpServer } from '@/shared/bindings/McpServer'
import { renderWithProviders } from '@/test/render'

import type { EditorDocument } from '@/features/editor/model'

import { McpCard } from './McpCard'

vi.mock('@/shared/api/ipc', () => ({
  ipc: { revealPath: vi.fn().mockResolvedValue(undefined) },
}))

function server(overrides: Partial<McpServer> = {}): McpServer {
  return {
    id: 'github#/a/.mcp.json',
    name: 'github',
    transport: { type: 'stdio', command: 'npx', args: ['-y'] },
    scope: { kind: 'global' },
    agent: { id: 'claude-code', name: 'Claude Code', icon: 'claude' },
    sourceConfig: '/a/.mcp.json',
    keyPath: ['mcpServers', 'github'],
    env: [],
    headers: [],
    raw: '{}',
    createdMs: Date.UTC(2024, 0, 2),
    modifiedMs: Date.UTC(2024, 5, 3),
    hasSecrets: false,
    enabled: true,
    removable: true,
    unverified: false,
    ...overrides,
  }
}

const document: EditorDocument = {
  path: '/a/.mcp.json',
  label: '.mcp.json',
  format: 'json',
  editable: true,
}

/** Right click the card's title — a hit area outside its own buttons. */
async function openMenu(container: HTMLElement) {
  fireEvent.contextMenu(within(container).getByText('github'), { clientX: 40, clientY: 60 })
  return within(await screen.findByRole('menu'))
}

describe('McpCard', () => {
  it('opens the server from the card itself', () => {
    const onOpen = vi.fn()
    const view = renderWithProviders(
      <McpCard server={server()} onOpen={onOpen} onDelete={vi.fn()} onToggle={vi.fn()} />,
    )

    // The body is the click target, by mouse and by keyboard alike.
    const body = within(view.container).getByRole('button', { name: 'github' })
    fireEvent.click(body)
    expect(onOpen).toHaveBeenCalledWith(server())

    fireEvent.keyDown(body, { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledTimes(2)

    view.unmount()
  })

  it('keeps the actions on the card out of the click that opens it', () => {
    const onOpen = vi.fn()
    const onOpenConfig = vi.fn()
    const onToggle = vi.fn()
    const onDelete = vi.fn()
    const view = renderWithProviders(
      <McpCard
        server={server()}
        sourceDocument={document}
        onOpen={onOpen}
        onOpenConfig={onOpenConfig}
        onDelete={onDelete}
        onToggle={onToggle}
      />,
    )

    fireEvent.click(within(view.container).getByRole('switch', { name: 'Switch off' }))
    expect(onToggle).toHaveBeenCalledWith(server(), false)

    fireEvent.click(within(view.container).getByRole('button', { name: 'Open config file' }))
    expect(onOpenConfig).toHaveBeenCalledWith(document)

    fireEvent.click(within(view.container).getByRole('button', { name: 'Remove server' }))
    expect(onDelete).toHaveBeenCalledWith(server())

    // A switch is a way of looking at the list, not a way into the detail view.
    expect(onOpen).not.toHaveBeenCalled()

    view.unmount()
  })

  it('offers the config file read-only when the manifest says so', () => {
    const view = renderWithProviders(
      <McpCard
        server={server()}
        sourceDocument={{ ...document, editable: false }}
        onOpenConfig={vi.fn()}
      />,
    )

    expect(within(view.container).getByRole('button', { name: 'View' })).toBeTruthy()
    expect(within(view.container).queryByRole('button', { name: 'Open config file' })).toBeNull()

    view.unmount()
  })
})

describe('McpCard context menu', () => {
  it('offers the card actions and dispatches the removal', async () => {
    const onDelete = vi.fn()
    const view = renderWithProviders(
      <McpCard
        server={server()}
        sourceDocument={document}
        onOpen={() => undefined}
        onOpenConfig={() => undefined}
        onDelete={onDelete}
        onToggle={vi.fn()}
      />,
    )

    expect(screen.queryByRole('menu')).toBeNull()

    const menu = await openMenu(view.container)
    expect(menu.getByRole('menuitem', { name: 'Open' })).toBeTruthy()
    expect(menu.getByRole('menuitem', { name: 'Open config file' })).toBeTruthy()
    expect(menu.getByRole('menuitem', { name: 'Switch off' })).toBeTruthy()
    expect(menu.getByRole('menuitem', { name: 'Copy path' })).toBeTruthy()
    expect(menu.getByRole('menuitem', { name: 'Show in file manager' })).toBeTruthy()
    expect(menu.getByRole('menuitem', { name: 'Remove server' })).toBeTruthy()

    fireEvent.click(menu.getByRole('menuitem', { name: 'Remove server' }))
    expect(onDelete).toHaveBeenCalledWith(server())

    view.unmount()
  })

  it('keeps the mutating actions off a server Ahabby may not touch', async () => {
    const view = renderWithProviders(
      <McpCard
        server={server({ removable: false })}
        onOpen={() => undefined}
        onDelete={vi.fn()}
        onToggle={vi.fn()}
      />,
    )

    const menu = await openMenu(view.container)
    expect(menu.getByRole('menuitem', { name: 'Open' })).toBeTruthy()
    expect(menu.getByRole('menuitem', { name: 'Copy path' })).toBeTruthy()
    expect(menu.queryByRole('menuitem', { name: 'Switch off' })).toBeNull()
    expect(menu.queryByRole('menuitem', { name: 'Remove server' })).toBeNull()

    view.unmount()
  })
})
