import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'

import { ipc } from '@/shared/api/ipc'
import type { Agent } from '@/shared/bindings/Agent'
import type { ConfigFact } from '@/shared/bindings/ConfigFact'
import type { ConfigFile } from '@/shared/bindings/ConfigFile'
import { renderWithProviders } from '@/test/render'

import { AgentFactsCard } from './AgentFactsCard'

vi.mock('@/shared/api/ipc', () => ({
  ipc: {
    fetchWebPage: vi.fn().mockResolvedValue({
      url: 'https://api.example.com/v1',
      kind: 'text',
      body: '{ "ok": true }',
      truncated: false,
    }),
    fetchWebImage: vi.fn().mockResolvedValue({ mime: 'image/png', base64: '' }),
    revealConfigFact: vi.fn().mockResolvedValue('sk-real-value'),
    readConfig: vi.fn().mockResolvedValue({
      path: '/home/u/.codex/config.toml',
      format: 'toml',
      content: '',
      sha256: 'sha-1',
      sizeBytes: 0,
      modifiedMs: 0,
      exists: true,
      truncated: false,
      editable: true,
    }),
    previewConfigFact: vi.fn().mockResolvedValue({
      path: '/home/u/.codex/config.toml',
      unified: '--- current\n+++ edited\n@@ -1 +1 @@\n-model = "gpt-5-codex"\n+model = "gpt-5.2"\n',
      added: 1,
      removed: 1,
      errors: [],
      inSync: true,
      currentSha256: 'sha-1',
    }),
    saveConfigFact: vi.fn().mockResolvedValue({
      data: {
        path: '/home/u/.codex/config.toml',
        sha256: 'sha-2',
        modifiedMs: 0,
        sizeBytes: 0,
      },
      report: { agents: [], projects: { folders: [], projects: [] } },
    }),
  },
}))

afterEach(cleanup)

function agent(facts: ConfigFact[], configs: ConfigFile[] = []): Agent {
  return { id: 'codex', facts, configs } as Agent
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

function config(overrides: Partial<ConfigFile> = {}): ConfigFile {
  return {
    id: 'config',
    label: 'config.toml',
    path: '/home/u/.codex/config.toml',
    format: 'toml',
    scope: { kind: 'global' },
    agent: { id: 'codex', name: 'Codex' },
    exists: true,
    editable: true,
    ...overrides,
  }
}

function render(facts: ConfigFact[], configs: ConfigFile[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderWithProviders(
    <QueryClientProvider client={client}>
      <AgentFactsCard agent={agent(facts, configs)} />
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

  it("opens an endpoint in Ahabby's own browser", async () => {
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
      expect(vi.mocked(ipc.fetchWebPage)).toHaveBeenCalledWith('https://api.example.com/v1'),
    )
  })

  it('heads the panel "Quick settings" and says the values can be edited', () => {
    render([fact({})])
    expect(screen.getByText('Quick settings')).toBeTruthy()
    expect(screen.getByText(/edit one right here/i)).toBeTruthy()
  })

  it('offers no edit affordance on a read-only config', () => {
    render([fact({})], [config({ editable: false })])
    expect(screen.queryByRole('button', { name: 'Edit value' })).toBeNull()
  })

  it('offers no edit affordance when the config is not there', () => {
    render([fact({})], [config({ exists: false })])
    expect(screen.queryByRole('button', { name: 'Edit value' })).toBeNull()
  })

  it('writes a plain value in place and offers the diff', async () => {
    render([fact({})], [config()])

    fireEvent.click(screen.getByRole('button', { name: 'Edit value' }))
    const input = await screen.findByRole('textbox', { name: 'Edit value' })
    fireEvent.change(input, { target: { value: 'gpt-5.2' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    // The frontend never sends a document: one dotted key, one value, the hash it read.
    await waitFor(() =>
      expect(vi.mocked(ipc.saveConfigFact)).toHaveBeenCalledWith(
        'codex',
        '/home/u/.codex/config.toml',
        'model',
        'gpt-5.2',
        'sha-1',
      ),
    )
    expect(vi.mocked(ipc.previewConfigFact)).toHaveBeenCalledWith(
      'codex',
      '/home/u/.codex/config.toml',
      'model',
      'gpt-5.2',
      'sha-1',
    )
  })
})
