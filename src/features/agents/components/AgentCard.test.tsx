import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { Agent } from '@/shared/bindings/Agent'
import { renderWithProviders } from '@/test/render'

import { AgentCard } from './AgentCard'

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
    configs: [],
    skills: [],
    mcpServers: [],
    other: [],
    update: null,
    unverified: [],
    notes: null,
    manifestSource: { kind: 'builtin' },
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
})
