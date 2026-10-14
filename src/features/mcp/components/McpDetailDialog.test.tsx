import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'

import { ipc } from '@/shared/api/ipc'
import type { McpServer } from '@/shared/bindings/McpServer'
import { renderWithProviders } from '@/test/render'

import type { EditorDocument } from '@/features/editor/model'

import { McpDetailDialog } from './McpDetailDialog'

vi.mock('@/shared/api/ipc', () => ({
  ipc: { revealPath: vi.fn(), revealMcpSecret: vi.fn() },
}))

/** CodeMirror is replaced by a pre — what this file is about is what the dialog is handed. */
vi.mock('@/shared/ui/CodeViewer', () => ({
  CodeViewer: ({ value }: { value: string }) => <pre>{value}</pre>,
}))

const document: EditorDocument = {
  path: '/a/.mcp.json',
  label: '.mcp.json',
  format: 'json',
  editable: true,
}

function server(overrides: Partial<McpServer> = {}): McpServer {
  return {
    id: 'github#/a/.mcp.json',
    name: 'github',
    transport: { type: 'stdio', command: 'npx', args: ['-y', 'server-github'] },
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

/**
 * The dialog is a Radix portal, so it lives outside the render container and is read through
 * `screen`; the agent's brand mark ships an SVG `<title>` with the agent name, which is not the
 * visible label.
 */
function dialog() {
  return within(screen.getByRole('dialog'))
}

const TEXT = { ignore: 'script, style, title' } as const

afterEach(cleanup)

describe('McpDetailDialog', () => {
  it('reads out the entry: transport, file, secrets and the JSON as it stands', () => {
    renderWithProviders(
      <McpDetailDialog
        server={server({
          raw: '{"command":"npx"}',
          hasSecrets: true,
          env: [
            { key: 'GITHUB_TOKEN', value: null, masked: true },
            { key: 'LOG_LEVEL', value: 'debug', masked: false },
          ],
          headers: [{ key: 'Authorization', value: null, masked: true }],
        })}
        open
        onOpenChange={vi.fn()}
      />,
    )

    const view = dialog()
    expect(view.getByRole('heading', { name: 'github' })).toBeTruthy()
    expect(view.getByText('stdio')).toBeTruthy()
    expect(view.getByText('Claude Code', TEXT)).toBeTruthy()

    // Where the entry lives: the file and the position inside it.
    expect(view.getByText('/a/.mcp.json')).toBeTruthy()
    expect(view.getByText('mcpServers.github')).toBeTruthy()

    // How it is spoken to.
    expect(view.getByText('npx')).toBeTruthy()
    expect(view.getByText('-y server-github')).toBeTruthy()

    // The secret is the mask until the user asks for it, and a plain value is shown as it is.
    expect(view.getByText('GITHUB_TOKEN')).toBeTruthy()
    expect(view.getAllByText('••••••••').length).toBe(2)
    expect(view.getByText('debug')).toBeTruthy()
    expect(view.getByText('1 secret value hidden')).toBeTruthy()

    expect(view.getByText('Raw entry')).toBeTruthy()
    expect(view.getByText('{"command":"npx"}')).toBeTruthy()
  })

  it('offers the actions of the card in its footer', () => {
    const onToggle = vi.fn()
    const onDelete = vi.fn()
    const onOpenConfig = vi.fn()
    renderWithProviders(
      <McpDetailDialog
        server={server()}
        open
        onOpenChange={vi.fn()}
        sourceDocument={document}
        onOpenConfig={onOpenConfig}
        onDelete={onDelete}
        onToggle={onToggle}
      />,
    )

    const view = dialog()
    fireEvent.click(view.getByRole('switch', { name: 'Switch off' }))
    expect(onToggle).toHaveBeenCalledWith(server(), false)

    fireEvent.click(view.getByRole('button', { name: 'Open config file' }))
    expect(onOpenConfig).toHaveBeenCalledWith(document)

    fireEvent.click(view.getByRole('button', { name: 'Remove server' }))
    expect(onDelete).toHaveBeenCalledWith(server())
  })

  it('keeps the mutating actions off a server Ahabby may not touch', () => {
    renderWithProviders(
      <McpDetailDialog
        server={server({ removable: false })}
        open
        onOpenChange={vi.fn()}
        onDelete={vi.fn()}
        onToggle={vi.fn()}
      />,
    )

    const view = dialog()
    expect(view.getByText('Ahabby will not change this one')).toBeTruthy()
    expect(view.queryByRole('switch')).toBeNull()
    expect(view.queryByRole('button', { name: 'Remove server' })).toBeNull()
  })

  it('shows an http server by its address', () => {
    renderWithProviders(
      <McpDetailDialog
        server={server({
          transport: { type: 'http', url: 'https://mcp.example.com/mcp', protocol: 'http' },
        })}
        open
        onOpenChange={vi.fn()}
      />,
    )

    const view = dialog()
    expect(view.getByText('https://mcp.example.com/mcp')).toBeTruthy()
    expect(view.getByText('URL · http')).toBeTruthy()
  })

  it('reads a masked value only when it is asked for', async () => {
    const target = server({
      hasSecrets: true,
      env: [{ key: 'GITHUB_TOKEN', value: null, masked: true }],
    })
    vi.mocked(ipc.revealMcpSecret).mockResolvedValue('ghp_asked')
    renderWithProviders(<McpDetailDialog server={target} open onOpenChange={vi.fn()} />)

    const view = dialog()
    expect(view.queryByText('ghp_asked')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Reveal' }))

    await waitFor(() => expect(view.getByText('ghp_asked')).toBeTruthy())
    expect(ipc.revealMcpSecret).toHaveBeenCalledWith('claude-code', target.id, 'GITHUB_TOKEN')
  })
})
