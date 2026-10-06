import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'

import { ipc } from '@/shared/api/ipc'
import type { Agent } from '@/shared/bindings/Agent'
import type { ConfigFact } from '@/shared/bindings/ConfigFact'
import { renderWithProviders } from '@/test/render'

import { AgentFactsCard } from './AgentFactsCard'

vi.mock('@/shared/api/ipc', () => ({
  ipc: {
    openUrl: vi.fn().mockResolvedValue(undefined),
    revealConfigFact: vi.fn().mockResolvedValue('sk-real-value'),
  },
}))

afterEach(cleanup)

function agent(facts: ConfigFact[]): Agent {
  return { id: 'codex', facts } as Agent
}

function fact(overrides: Partial<ConfigFact>): ConfigFact {
  return {
    id: 'config:model',
    kind: 'model',
    key: 'model',
    value: 'gpt-5-codex',
    masked: false,
    configId: 'config',
    configLabel: 'config.toml',
    configPath: '/home/u/.codex/config.toml',
    ...overrides,
  }
}

function render(facts: ConfigFact[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderWithProviders(
    <QueryClientProvider client={client}>
      <AgentFactsCard agent={agent(facts)} />
    </QueryClientProvider>,
  )
}

describe('AgentFactsCard', () => {
  it('renders nothing without facts', () => {
    const { container } = render([])
    expect(container.textContent).toBe('')
  })

  it('shows values grouped by their config file, credentials masked', () => {
    render([
      fact({}),
      fact({
        id: 'settings:env.OPENAI_API_KEY',
        kind: 'secret',
        key: 'env.OPENAI_API_KEY',
        value: 'sk-••••••90',
        masked: true,
        configId: 'settings',
        configLabel: 'settings.json',
        configPath: '/home/u/.codex/settings.json',
      }),
    ])

    expect(screen.getByText('gpt-5-codex')).toBeTruthy()
    expect(screen.getByText('config.toml')).toBeTruthy()
    expect(screen.getByText('settings.json')).toBeTruthy()
    expect(screen.getByText('Default model')).toBeTruthy()
    expect(screen.getByText('Credential')).toBeTruthy()
    // The masked value is all the scan ever sends; nothing to reveal yet.
    expect(screen.queryByText('sk-real-value')).toBeNull()
  })

  it('asks the backend for the real value on reveal', async () => {
    render([
      fact({
        id: 'settings:env.OPENAI_API_KEY',
        kind: 'secret',
        key: 'env.OPENAI_API_KEY',
        value: 'sk-••••••90',
        masked: true,
        configId: 'settings',
        configLabel: 'settings.json',
        configPath: '/home/u/.codex/settings.json',
      }),
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Reveal' }))

    await waitFor(() => expect(screen.getByText('sk-real-value')).toBeTruthy())
    expect(vi.mocked(ipc.revealConfigFact)).toHaveBeenCalledWith(
      'codex',
      '/home/u/.codex/settings.json',
      'env.OPENAI_API_KEY',
    )
  })

  it('offers only reveal for a masked proxy until it is revealed', async () => {
    render([
      fact({
        id: 'settings:httpProxy',
        kind: 'proxy',
        key: 'httpProxy',
        value: 'http://••••••@10.0.0.1:3128',
        masked: true,
        configId: 'settings',
        configLabel: 'settings.json',
        configPath: '/home/u/.codex/settings.json',
      }),
    ])

    expect(screen.getByText('http://••••••@10.0.0.1:3128')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open link' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy value' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Reveal' }))

    await waitFor(() => expect(screen.getByText('sk-real-value')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Open link' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy value' })).toBeTruthy()
  })

  it('opens an endpoint through the backend', async () => {
    render([
      fact({
        id: 'config:base_url',
        kind: 'url',
        key: 'base_url',
        value: 'https://api.example.com/v1',
      }),
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Open link' }))
    await waitFor(() =>
      expect(vi.mocked(ipc.openUrl)).toHaveBeenCalledWith('https://api.example.com/v1'),
    )
  })
})
