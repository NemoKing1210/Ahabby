import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ipc } from '@/shared/api/ipc'
import type { AgentRef } from '@/shared/bindings/AgentRef'
import type { HubEntry } from '@/shared/bindings/HubEntry'
import type { HubEntryDetail } from '@/shared/bindings/HubEntryDetail'
import type { HubInstall } from '@/shared/bindings/HubInstall'
import type { HubPage as HubPageResult } from '@/shared/bindings/HubPage'
import type { HubResourceKind } from '@/shared/bindings/HubResourceKind'
import type { HubSource } from '@/shared/bindings/HubSource'
import type { HubSourceReport } from '@/shared/bindings/HubSourceReport'
import type { MutationResult } from '@/shared/bindings/MutationResult'
import { emptyScanReport, testSettings } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

import { HubQuickInstallDialog } from './HubQuickInstallDialog'

vi.mock('@/shared/api/ipc', () => ({
  ipc: {
    listHubSources: vi.fn(),
    searchHub: vi.fn(),
    getHubEntry: vi.fn(),
    installHubResource: vi.fn(),
    rescan: vi.fn(),
    cachedAgents: vi.fn(),
    getSettings: vi.fn(),
  },
}))

// The stub has to be published before `lazyRows` is imported, which a hoisted callback does — see
// `@/test/intersectionObserver` for why the module is reached through a dynamic import.
const { FakeIntersectionObserver } = await vi.hoisted(async () => {
  const stub = await import('@/test/intersectionObserver')
  stub.installFakeIntersectionObserver()
  return { FakeIntersectionObserver: stub.FakeIntersectionObserver }
})

// Radix opens the list on pointerdown and scrolls the active row into view; jsdom has neither
// pointer capture nor `scrollIntoView` (see `shared/ui/Select.test.tsx`).
Element.prototype.hasPointerCapture = () => false
Element.prototype.setPointerCapture = () => {}
Element.prototype.releasePointerCapture = () => {}
Element.prototype.scrollIntoView = () => {}

/** The owner the agent page's tab belongs to. */
const OWNER: AgentRef = { id: 'demo', name: 'Demo Agent', icon: null }

function source(overrides: Partial<HubSource> = {}): HubSource {
  return {
    id: 'example-skills',
    name: 'Example Skills',
    kind: 'githubSkills',
    description: 'A collection of skills.',
    provides: ['skill'],
    homepage: 'https://github.com/owner/repo',
    docs: null,
    license: 'MIT',
    vendor: 'Owner',
    url: null,
    repository: 'owner/repo',
    stars: null,
    gitRef: null,
    path: null,
    exclude: [],
    tags: [],
    tagRules: [],
    builtin: true,
    sourceFile: null,
    ...overrides,
  }
}

const SKILLS = source()
const OTHER = source({ id: 'other-skills', name: 'Other Skills', repository: 'owner/other' })
const REGISTRY = source({
  id: 'mcp-registry',
  name: 'MCP Registry',
  kind: 'mcpRegistry',
  provides: ['mcp'],
  repository: null,
  url: 'https://registry.example.com',
})

function entry(overrides: Partial<HubEntry> = {}): HubEntry {
  return {
    id: 'example-skills/skills/pdf',
    sourceId: 'example-skills',
    sourceName: 'Example Skills',
    kind: 'skill',
    name: 'pdf',
    title: null,
    description: 'Read and fill PDF forms.',
    version: null,
    vendor: 'Owner',
    homepage: null,
    repository: 'https://github.com/owner/repo',
    license: 'MIT',
    tags: [],
    group: null,
    fileCount: 2,
    sizeBytes: 2048,
    installable: true,
    installProblem: null,
    inputCount: 0,
    hasScripts: false,
    installed: [],
    ...overrides,
  }
}

function report(overrides: Partial<HubSourceReport> = {}): HubSourceReport {
  return {
    id: 'example-skills',
    name: 'Example Skills',
    kind: 'githubSkills',
    provides: ['skill'],
    description: 'A collection of skills.',
    homepage: null,
    builtin: true,
    count: 1,
    total: 1,
    nextCursor: null,
    durationMs: 12,
    fromCache: false,
    error: null,
    problems: [],
    ...overrides,
  }
}

function page(overrides: Partial<HubPageResult> = {}): HubPageResult {
  return { entries: [entry()], report: report(), fetchedAtMs: 0, ...overrides }
}

function skillDetail(): HubEntryDetail {
  return {
    entry: entry(),
    files: [
      { path: 'SKILL.md', sizeBytes: 1200, kind: 'text' },
      { path: 'forms/fill.py', sizeBytes: 848, kind: 'text' },
    ],
    preview: null,
    transport: null,
    inputs: [],
    sourceUrl: 'https://github.com/owner/repo/skills/pdf',
  }
}

/** What the backend answers with after writing the entry. */
function installed(): HubInstall {
  return {
    kind: 'skill',
    entryId: 'example-skills/skills/pdf',
    owner: OWNER,
    path: '/home/me/.demo/skills/pdf',
    filesWritten: 2,
    skill: null,
    server: null,
  }
}

/**
 * The dialog over a fresh query client, opened the way a tab opens it. Its content lands in the
 * document, not in the render container: every dialog is portalled.
 */
function renderDialog(kind: HubResourceKind = 'skill') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderWithProviders(
    <QueryClientProvider client={client}>
      <HubQuickInstallDialog kind={kind} owner={OWNER} onClose={() => {}} />
    </QueryClientProvider>,
  )
}

/**
 * The review an install goes through, found by the target field only it has. Its own heading is
 * the entry's name once the detail arrives, so the heading is not what identifies it.
 */
async function reviewDialog(): Promise<HTMLElement> {
  const target = await screen.findByText('Install for')
  const dialog = target.closest('[role="dialog"]')
  if (!dialog) throw new Error('the review is not in a dialog')
  return dialog as HTMLElement
}

/** The review of a whole batch, found by the heading only it has (the kind badge rides with it). */
async function batchDialog(): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name: /Install selected skills/ })
  const dialog = heading.closest('[role="dialog"]')
  if (!dialog) throw new Error('the batch review is not in a dialog')
  return dialog as HTMLElement
}

/** The collections the dialog has actually asked, in order. */
function askedSources(): string[] {
  return vi.mocked(ipc.searchHub).mock.calls.map(([sourceId]) => sourceId)
}

describe('HubQuickInstallDialog', () => {
  beforeEach(() => {
    FakeIntersectionObserver.reset()
    vi.mocked(ipc.listHubSources).mockResolvedValue({
      sources: [SKILLS, OTHER, REGISTRY],
      problems: [],
    })
    vi.mocked(ipc.searchHub).mockResolvedValue(page())
    vi.mocked(ipc.getHubEntry).mockResolvedValue(skillDetail())
    vi.mocked(ipc.installHubResource).mockResolvedValue({
      data: installed(),
      report: emptyScanReport,
    })
    vi.mocked(ipc.rescan).mockResolvedValue(emptyScanReport)
    // The review the install goes through reads the owners and the pinned agents off the same
    // queries the app already holds.
    vi.mocked(ipc.cachedAgents).mockResolvedValue(emptyScanReport)
    vi.mocked(ipc.getSettings).mockResolvedValue(testSettings())
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('asks only the collection it reads, for the kind it was opened with', async () => {
    renderDialog('skill')

    expect(await screen.findByText('pdf')).toBeTruthy()
    expect(askedSources()).toEqual(['example-skills'])
    expect(ipc.searchHub).toHaveBeenCalledWith(
      'example-skills',
      expect.objectContaining({ query: '', kind: 'skill', tags: [], cursor: null, refresh: false }),
    )
  })

  it('reads the only collection that offers the kind, without offering a choice', async () => {
    renderDialog('mcp')

    // The registry is the only source that carries servers, so the collection is named rather than
    // chosen: a picker with one option is not a control.
    expect(await screen.findByText('MCP Registry')).toBeTruthy()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(askedSources()).toEqual(['mcp-registry'])
  })

  it('reads the collection the user picks', async () => {
    const user = userEvent.setup()
    renderDialog('skill')

    await user.click(await screen.findByRole('combobox', { name: 'Source' }))
    await user.click(await screen.findByRole('option', { name: 'Other Skills' }))

    await waitFor(() => expect(askedSources()).toEqual(['example-skills', 'other-skills']))
  })

  it('narrows the entries in hand without asking again', async () => {
    const user = userEvent.setup()
    vi.mocked(ipc.searchHub).mockResolvedValue(
      page({
        entries: [
          entry({
            installed: [
              {
                owner: { id: 'shared', name: 'Shared', icon: null },
                scope: { kind: 'global' },
                path: '/home/me/.agents/skills/pdf',
                enabled: true,
                identical: true,
              },
            ],
          }),
          entry({ id: 'example-skills/skills/slides', name: 'slides' }),
        ],
      }),
    )
    renderDialog('skill')

    expect(await screen.findByText('pdf')).toBeTruthy()
    expect(screen.getByText('slides')).toBeTruthy()
    const reads = vi.mocked(ipc.searchHub).mock.calls.length

    await user.click(screen.getByRole('button', { name: 'Not installed' }))

    await waitFor(() => expect(screen.queryByText('pdf')).toBeNull())
    expect(screen.getByText('slides')).toBeTruthy()
    // Whether this machine already holds an entry is the scan's answer, not the collection's.
    expect(vi.mocked(ipc.searchHub).mock.calls.length).toBe(reads)
  })

  it('reads the next page only when asked', async () => {
    const user = userEvent.setup()
    vi.mocked(ipc.searchHub).mockResolvedValue(page({ report: report({ nextCursor: 'page-2' }) }))
    renderDialog('skill')

    await user.click(await screen.findByRole('button', { name: 'Load more' }))

    await waitFor(() =>
      expect(ipc.searchHub).toHaveBeenCalledWith(
        'example-skills',
        expect.objectContaining({ cursor: 'page-2' }),
      ),
    )
  })

  it('installs into the owner the tab belongs to, reviewed first', async () => {
    const user = userEvent.setup()
    renderDialog('skill')

    await user.click(await screen.findByRole('button', { name: 'Install' }))

    // The review names the target and offers no choice of one: the tab is this agent's.
    const review = await reviewDialog()
    expect(within(review).getByText('Demo Agent')).toBeTruthy()
    expect(within(review).queryByRole('combobox')).toBeNull()

    await user.click(within(review).getByRole('button', { name: 'Install' }))

    await waitFor(() =>
      expect(ipc.installHubResource).toHaveBeenCalledWith({
        ownerId: 'demo',
        entryId: 'example-skills/skills/pdf',
        name: null,
        transport: null,
        confirm: true,
        // A single install is the one that re-reads the machine: its answer is the fresh report.
        scan: true,
      }),
    )
  })

  it('asks the collection for what is typed, once typing settles', async () => {
    const user = userEvent.setup()
    renderDialog('skill')

    await user.type(await screen.findByRole('textbox', { name: 'Search' }), 'slides')

    await waitFor(() =>
      expect(ipc.searchHub).toHaveBeenCalledWith(
        'example-skills',
        expect.objectContaining({ query: 'slides' }),
      ),
    )
  })

  it('installs the ticked skills in one batch, for the same owner', async () => {
    const user = userEvent.setup()
    vi.mocked(ipc.searchHub).mockResolvedValue(
      page({ entries: [entry(), entry({ id: 'example-skills/skills/slides', name: 'slides' })] }),
    )
    renderDialog('skill')

    // Nothing ticked, the bar stands for the whole list on screen — and says so.
    expect(await screen.findByRole('button', { name: 'Install all 2 on screen' })).toBeTruthy()

    await user.click(screen.getByRole('checkbox', { name: 'Select pdf' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select slides' }))
    await user.click(screen.getByRole('button', { name: 'Install 2 skills' }))

    const batch = await batchDialog()
    await user.click(within(batch).getByRole('button', { name: 'Install 2 skills' }))

    await waitFor(() => expect(ipc.installHubResource).toHaveBeenCalledTimes(2))
    // Both writes are the same install the single entry goes through, one after the other — and
    // neither of them re-reads the machine: the batch scans once, when the set is on disk.
    expect(vi.mocked(ipc.installHubResource).mock.calls.map(([request]) => request)).toEqual([
      {
        ownerId: 'demo',
        entryId: 'example-skills/skills/pdf',
        name: null,
        transport: null,
        confirm: true,
        scan: false,
      },
      {
        ownerId: 'demo',
        entryId: 'example-skills/skills/slides',
        name: null,
        transport: null,
        confirm: true,
        scan: false,
      },
    ])
    await waitFor(() => expect(ipc.rescan).toHaveBeenCalledTimes(1))
  })

  it('writes several skills at once and scans once for the whole batch', async () => {
    const user = userEvent.setup()
    const waiting: Array<(result: MutationResult<HubInstall>) => void> = []
    vi.mocked(ipc.installHubResource).mockImplementation(
      () => new Promise<MutationResult<HubInstall>>((resolve) => waiting.push(resolve)),
    )
    vi.mocked(ipc.searchHub).mockResolvedValue(
      page({
        entries: [
          entry(),
          entry({ id: 'example-skills/skills/slides', name: 'slides' }),
          entry({ id: 'example-skills/skills/plan', name: 'plan' }),
        ],
      }),
    )
    renderDialog('skill')

    await user.click(await screen.findByRole('button', { name: 'Install all 3 on screen' }))
    const batch = await batchDialog()
    await user.click(within(batch).getByRole('button', { name: 'Install 3 skills' }))

    // The pool never waits for one write to finish before starting the next.
    await waitFor(() => expect(ipc.installHubResource).toHaveBeenCalledTimes(3))
    expect(waiting).toHaveLength(3)
    expect(within(batch).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')

    await act(async () => {
      for (const resolve of waiting) {
        resolve({ data: installed(), report: emptyScanReport })
      }
      // One tick for the resolved writes to reach the state the assertions below read.
      await Promise.resolve()
    })

    // One scan for the whole batch, not one per file.
    await waitFor(() => expect(ipc.rescan).toHaveBeenCalledTimes(1))
    expect(within(batch).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3')
  })

  it('leaves the batch out of the MCP tab, where a server is reviewed one at a time', async () => {
    vi.mocked(ipc.searchHub).mockResolvedValue(
      page({
        entries: [
          entry({
            id: 'mcp-registry/com.example/files',
            sourceId: 'mcp-registry',
            sourceName: 'MCP Registry',
            kind: 'mcp',
            name: 'com.example/files',
            description: 'Reads files',
          }),
        ],
        report: report({ id: 'mcp-registry', name: 'MCP Registry', kind: 'mcpRegistry' }),
      }),
    )
    renderDialog('mcp')

    expect(await screen.findByText('com.example/files')).toBeTruthy()
    // A server carries a launch recipe and the values it needs: that is a form, not a tick box.
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /Install all/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Select all/ })).toBeNull()
  })
})
