import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ipc } from '@/shared/api/ipc'
import type { HubEntry } from '@/shared/bindings/HubEntry'
import type { HubEntryDetail } from '@/shared/bindings/HubEntryDetail'
import type { HubPage as HubPageResult } from '@/shared/bindings/HubPage'
import type { HubSource } from '@/shared/bindings/HubSource'
import type { HubSourceCatalog } from '@/shared/bindings/HubSourceCatalog'
import type { HubSourceReport } from '@/shared/bindings/HubSourceReport'
import type { ScanReport } from '@/shared/bindings/ScanReport'
import { tagHue } from '@/shared/lib/tagColor'
import { renderWithProviders } from '@/test/render'

import { HubPage } from './HubPage'
import { testSettings } from '@/test/fixtures'

vi.mock('@/shared/api/ipc', () => ({
  ipc: {
    listHubSources: vi.fn(),
    searchHub: vi.fn(),
    getHubEntry: vi.fn(),
    compareHubSkill: vi.fn(),
    installHubResource: vi.fn(),
    rescan: vi.fn(),
    cachedAgents: vi.fn(),
    getSettings: vi.fn(),
    openUrl: vi.fn(),
    fetchWebImage: vi.fn(),
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

const SKILLS_SOURCE: HubSource = {
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
  stars: 18432,
  gitRef: null,
  path: null,
  exclude: [],
  tags: ['development'],
  tagRules: [{ prefix: 'skills/pdf', tags: ['documents'] }],
  builtin: true,
  sourceFile: null,
}

const REGISTRY_SOURCE: HubSource = {
  ...SKILLS_SOURCE,
  id: 'mcp-registry',
  name: 'MCP Registry',
  kind: 'mcpRegistry',
  provides: ['mcp'],
  repository: null,
  stars: null,
  url: 'https://registry.example.com',
}

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
    hasScripts: true,
    installed: [],
    ...overrides,
  }
}

/** The same entry, already held by the shared surface (and matching it) and by the demo agent. */
function installedEntry(): HubEntry {
  return entry({
    installed: [
      {
        owner: { id: 'shared', name: 'Shared', icon: null },
        scope: { kind: 'global' },
        path: '/home/me/.agents/skills/pdf',
        enabled: true,
        identical: true,
      },
      {
        owner: { id: 'demo', name: 'Demo Agent', icon: null },
        scope: { kind: 'global' },
        path: '/home/me/.claude/skills/pdf',
        enabled: false,
        identical: null,
      },
    ],
  })
}

function report(overrides: Partial<HubSourceReport> = {}): HubSourceReport {
  return {
    id: 'example-skills',
    name: 'Example Skills',
    kind: 'githubSkills',
    provides: ['skill'],
    description: 'A collection of skills.',
    homepage: 'https://github.com/owner/repo',
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

/** One installed agent of the fixture report; the two differ only in id, name and binary. */
function installedAgent(id: string, name: string) {
  return {
    id,
    name,
    description: 'Fixture agent',
    tagline: null,
    icon: null,
    category: null,
    website: null,
    docs: null,
    vendor: null,
    features: [],
    github: null,
    popular: false,
    status: 'installed' as const,
    binaryPath: `/bin/${id}`,
    foundIn: 'path' as const,
    version: null,
    installedVia: null,
    installOptions: [],
    canInstall: false,
    installDocsUrl: null,
    canUpdate: false,
    canUninstall: false,
    configs: [],
    facts: [],
    skills: [],
    mcpServers: [],
    other: [],
    extensions: [],
    extensionsSupported: false,
    update: null,
    unverified: [],
    notes: null,
    manifestSource: { kind: 'builtin' as const },
    removal: 'hidden' as const,
    warnings: [],
    scanMs: 1,
  }
}

/** A scan report with two installed agents and one project: all of them are install targets. */
function scanReport(): ScanReport {
  return {
    agents: [installedAgent('demo', 'Demo Agent'), installedAgent('warp', 'Warp')],
    problems: [],
    scannedAtMs: 0,
    durationMs: 0,
    installed: 1,
    availableToInstall: 0,
    os: 'windows',
    shared: { configs: [], skills: [], mcpServers: [], other: [], roots: [] },
    projects: {
      folders: [],
      projects: [
        {
          id: 'project:abc',
          name: 'app',
          root: '/home/me/app',
          folderId: 'folder:one',
          skills: [],
          mcpServers: [],
          other: [],
          configs: [],
          modifiedMs: null,
          warnings: [],
          scanMs: 1,
        },
      ],
      scannedAtMs: 0,
      durationMs: 0,
    },
  }
}

const SETTINGS = testSettings()

function skillDetail(): HubEntryDetail {
  return {
    entry: entry(),
    files: [
      { path: 'SKILL.md', sizeBytes: 1200, kind: 'text' },
      { path: 'scripts/fill.py', sizeBytes: 848, kind: 'script' },
    ],
    preview: {
      path: 'SKILL.md',
      content: '# PDF toolkit\n\nFill the form in one pass.',
      frontmatter: [{ key: 'name', value: 'pdf' }],
      truncated: false,
    },
    transport: null,
    inputs: [],
    sourceUrl: 'https://github.com/owner/repo/skills/pdf',
  }
}

function serverDetail(): HubEntryDetail {
  return {
    entry: entry({
      id: 'mcp-registry/com.example/files',
      sourceId: 'mcp-registry',
      sourceName: 'MCP Registry',
      kind: 'mcp',
      name: 'com.example/files',
      description: 'Reads files',
      fileCount: null,
      sizeBytes: null,
      hasScripts: false,
      inputCount: 1,
    }),
    files: [],
    preview: null,
    transport: { type: 'stdio', command: 'npx', args: ['-y', '@example/files-mcp'] },
    inputs: [
      { key: 'ROOT', description: 'Root to serve', required: true, secret: false, default: null },
    ],
    sourceUrl: 'https://example.com/files',
  }
}

/**
 * The page over a fresh query client. Each source paints its heading as soon as its source file is
 * known and its entries a moment later, when the collection itself answers — so a case waits for
 * the entry it means to assert on (or the card it means to click), never for the heading alone.
 */
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderWithProviders(
    <QueryClientProvider client={client}>
      <HubPage />
    </QueryClientProvider>,
  )
}

/**
 * The entry rows actually mounted: one per card or placeholder, which is what `useLazyRows` bounds
 * — the entries behind the ones on screen are the caller's data, not the list's markup. Counted
 * inside a section: the page's own list of sources is a card run too, and a source is not an entry.
 */
function mountedRows(container: HTMLElement): number {
  return container.querySelectorAll('.ah-card-group .ah-card-group > *').length
}

/**
 * Opens one source's section. The Hub opens with every collection folded, so a case that means to
 * read entries opens the one it reads from — the heading, and with it the control, is on screen
 * already.
 */
async function openSource(container: HTMLElement, name: string) {
  const user = userEvent.setup()
  await user.click(await within(container).findByRole('button', { name: `Expand ${name}` }))
}

/**
 * The card a heading of the Hub wears — the section around it. Every level of the screen is one:
 * a source, and the plugin groups inside it.
 */
function cardOf(container: HTMLElement, name: string): HTMLElement {
  const title = within(container).getByRole('heading', { name })
  const card = title.closest('section')
  if (!card) throw new Error(`the heading of ${name} is not in a section`)
  return card
}

describe('HubPage', () => {
  beforeEach(() => {
    FakeIntersectionObserver.reset()
    vi.mocked(ipc.cachedAgents).mockResolvedValue(scanReport())
    // A batch of installs scans the machine once, at the end, instead of once per file.
    vi.mocked(ipc.rescan).mockResolvedValue(scanReport())
    // The pinned agent is the one an agent picker offers first.
    vi.mocked(ipc.getSettings).mockResolvedValue({ ...SETTINGS, favoriteAgents: ['warp'] })
    vi.mocked(ipc.listHubSources).mockResolvedValue({
      sources: [SKILLS_SOURCE, REGISTRY_SOURCE],
      problems: [],
    })
    vi.mocked(ipc.searchHub).mockImplementation((sourceId) =>
      Promise.resolve(
        sourceId === SKILLS_SOURCE.id
          ? page()
          : page({
              entries: [
                entry({
                  id: 'mcp-registry/com.example/files',
                  sourceId: 'mcp-registry',
                  sourceName: 'MCP Registry',
                  kind: 'mcp',
                  name: 'com.example/files',
                  description: 'Reads files',
                  hasScripts: false,
                }),
              ],
              report: report({ id: 'mcp-registry', name: 'MCP Registry', kind: 'mcpRegistry' }),
            }),
      ),
    )
    vi.mocked(ipc.getHubEntry).mockResolvedValue(skillDetail())
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders one section per source and installs nothing on its own', async () => {
    const { container } = renderPage()

    // Every source is one folded section: its heading is on screen, its collection behind it.
    expect(await within(container).findByText('Example Skills')).toBeTruthy()
    expect(within(container).getByText('MCP Registry')).toBeTruthy()
    expect(within(container).getByRole('button', { name: 'Expand Example Skills' })).toBeTruthy()

    await openSource(container, 'Example Skills')
    expect(await within(container).findByText('Read and fill PDF forms.')).toBeTruthy()
    expect(within(container).getByText('Runs scripts')).toBeTruthy()
    expect(ipc.installHubResource).not.toHaveBeenCalled()
  })

  it('opens with every collection folded, and opens one from its heading', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()

    // The Hub opens as the list of collections it can read — one heading each — rather than as a
    // wall of every entry of every one of them.
    await within(container).findByText('Example Skills')
    expect(within(container).getByRole('button', { name: 'Expand Example Skills' })).toBeTruthy()
    expect(within(container).getByRole('button', { name: 'Expand MCP Registry' })).toBeTruthy()
    // Nothing of a folded collection is mounted, so its cards cannot be read before it is opened.
    expect(within(container).queryByText('Read and fill PDF forms.')).toBeNull()

    await user.click(within(container).getByRole('button', { name: 'Expand Example Skills' }))
    expect(await within(container).findByText('Read and fill PDF forms.')).toBeTruthy()
    // The other collection stays as it was left.
    expect(within(container).getByRole('button', { name: 'Expand MCP Registry' })).toBeTruthy()

    await user.click(within(container).getByRole('button', { name: 'Collapse Example Skills' }))
    await waitFor(() =>
      expect(within(container).queryByText('Read and fill PDF forms.')).toBeNull(),
    )
  })

  it('joins the sources into one card run, on the surface their fold calls for', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    await within(container).findByText('Example Skills')

    // Every source is a card of the page's own run — `--group-gap` apart, with the full radius only
    // at the ends of the stack — the way the Settings index wears its areas.
    const card = cardOf(container, 'Example Skills')
    expect(card.classList.contains('border')).toBe(true)
    expect(cardOf(container, 'MCP Registry').parentElement?.parentElement).toBe(
      card.parentElement?.parentElement,
    )

    // Folded, that card is the plain surface of the list; opened, its strip is the tinted caption
    // band its collection hangs under — and for the most starred collection of the Hub that band
    // wears the accent. The section's actions stay on the card either way.
    const folded = card.firstElementChild
    expect(folded?.classList.contains('bg-surface-2')).toBe(false)
    expect(folded?.classList.contains('bg-accent-soft')).toBe(false)
    expect(await within(card).findByRole('button', { name: 'Select 1 on screen' })).toBeTruthy()

    await user.click(within(container).getByRole('button', { name: 'Expand Example Skills' }))
    await within(container).findByText('Read and fill PDF forms.')

    expect(card.firstElementChild?.classList.contains('bg-accent-soft')).toBe(true)
  })

  it('ranks the three most starred collections of the Hub, and only those', async () => {
    // The Hub is its own leaderboard: the order the sources arrive in — the backend hands them over
    // most-starred first — decides who wears a rank, and a collection past the third wears none.
    const starred = (id: string, stars: number): HubSource => ({
      ...SKILLS_SOURCE,
      id,
      name: id,
      repository: `owner/${id}`,
      stars,
    })
    vi.mocked(ipc.listHubSources).mockResolvedValue({
      sources: [
        starred('first', 298665),
        starred('second', 180927),
        starred('third', 162751),
        starred('fourth', 106201),
      ],
      problems: [],
    })
    vi.mocked(ipc.searchHub).mockImplementation((sourceId) =>
      Promise.resolve(
        page({ entries: [], report: report({ id: sourceId, name: sourceId, total: 0, count: 0 }) }),
      ),
    )

    const user = userEvent.setup()
    const { container } = renderPage()
    await within(container).findByText('first')

    expect(within(cardOf(container, 'first')).getByLabelText('Top 1 by stars')).toBeTruthy()
    expect(within(cardOf(container, 'second')).getByLabelText('Top 2 by stars')).toBeTruthy()
    expect(within(cardOf(container, 'third')).getByLabelText('Top 3 by stars')).toBeTruthy()
    expect(within(cardOf(container, 'fourth')).queryByLabelText(/^Top \d by stars$/)).toBeNull()
    // The edge of the card says the same: the leader wears the full accent, the two behind it a
    // quieter one, and the fourth keeps the border of any other collection.
    expect(cardOf(container, 'first').classList.contains('border-accent/40')).toBe(true)
    expect(cardOf(container, 'third').classList.contains('border-accent/20')).toBe(true)
    expect(cardOf(container, 'fourth').classList.contains('border-accent/40')).toBe(false)

    // A filter narrows what is on screen, never who is in the lead: narrowed to the fourth
    // collection there is still one rank on the page, and it is the third collection's.
    await user.click(screen.getByRole('combobox', { name: 'Source' }))
    const options = await screen.findAllByRole('option')
    const fourth = options.find((option) => option.textContent === 'fourth')
    if (!fourth) throw new Error('the source filter lists no fourth collection')
    await user.click(fourth)

    await waitFor(() => expect(within(container).queryByText('first')).toBeNull())
    expect(within(cardOf(container, 'fourth')).queryByLabelText(/^Top \d by stars$/)).toBeNull()
  })

  it('paints the avatar GitHub keeps for a collection, and a monogram where there is none', async () => {
    const avatar = 'https://avatars.githubusercontent.com/u/1?v=4'
    vi.mocked(ipc.listHubSources).mockResolvedValue({
      sources: [{ ...SKILLS_SOURCE, avatar }, REGISTRY_SOURCE],
      problems: [],
    })
    vi.mocked(ipc.fetchWebImage).mockResolvedValue({ mime: 'image/png', base64: 'AAAA' })

    const { container } = renderPage()
    await within(container).findByText('Example Skills')

    // The bytes arrive from the backend as a `data:` URL — the window's CSP loads nothing else — and a
    // source that is not on GitHub, or whose picture could not be read, keeps the monogram tile.
    const image = await waitFor(() => {
      const painted = cardOf(container, 'Example Skills').querySelector('img')
      if (!painted) throw new Error('the source painted no avatar')
      return painted
    })
    expect(image.getAttribute('src')).toBe('data:image/png;base64,AAAA')
    expect(ipc.fetchWebImage).toHaveBeenCalledWith(avatar)
    expect(cardOf(container, 'MCP Registry').querySelector('img')).toBeNull()
  })

  it('wears a plugin group as a card of its own, welded inside its source', async () => {
    const user = userEvent.setup()
    vi.mocked(ipc.listHubSources).mockResolvedValue({
      sources: [SKILLS_SOURCE],
      problems: [],
    })
    const grouped = (name: string) =>
      entry({
        id: `example-skills/plugins/teams/skills/${name}`,
        name,
        group: 'teams',
        hasScripts: false,
      })
    vi.mocked(ipc.searchHub).mockResolvedValue(
      page({ entries: [grouped('review'), grouped('plan')] }),
    )

    const { container } = renderPage()
    await openSource(container, 'Example Skills')

    // The group wears the same card one level in, and the source welds its groups into a run of
    // their own.
    const group = cardOf(container, 'Teams')
    expect(group.classList.contains('border')).toBe(true)
    expect(group.parentElement?.classList.contains('ah-card-stack')).toBe(true)
    expect(group.firstElementChild?.classList.contains('bg-surface-2')).toBe(false)

    await user.click(within(container).getByRole('button', { name: 'Expand Teams' }))
    expect(await within(container).findByRole('button', { name: 'review' })).toBeTruthy()
    expect(group.firstElementChild?.classList.contains('bg-surface-2')).toBe(true)
    // Its skills are inside that card, on the canvas it frames.
    expect(within(group).getByRole('button', { name: 'plan' })).toBeTruthy()
  })

  it('takes the whole collection from its heading even when its skills sit in groups', async () => {
    vi.mocked(ipc.listHubSources).mockResolvedValue({
      sources: [SKILLS_SOURCE],
      problems: [],
    })
    const grouped = (name: string) =>
      entry({
        id: `example-skills/plugins/teams/skills/${name}`,
        name,
        group: 'teams',
        hasScripts: false,
      })
    vi.mocked(ipc.searchHub).mockResolvedValue(
      page({ entries: [grouped('review'), grouped('plan')] }),
    )

    const { container } = renderPage()
    await within(container).findByRole('heading', { name: 'Example Skills' })
    const card = cardOf(container, 'Example Skills')

    // The section's own actions are not the group's: a collection whose skills all sit in plugin
    // groups can still be taken whole from its heading, not only one group at a time.
    const user = userEvent.setup()
    await user.click(await within(card).findByRole('button', { name: 'Install all 2 on screen' }))

    // The same reviewed batch dialog the flat list opens, over both group skills.
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Install selected skills')).toBeTruthy()
  })

  it('offers a source its own context menu, every item translated', async () => {
    const { container } = renderPage()
    await within(container).findByText('Example Skills')
    const card = cardOf(container, 'Example Skills')

    // The source's own strip is the trigger — the collection's cards keep their own menu.
    const strip = card.firstElementChild
    if (!strip) throw new Error('the source card has no strip')
    fireEvent.contextMenu(strip)
    const menu = await screen.findByRole('menu')

    // Every action the card can take, named in the reader's language — and a name for the menu
    // itself. A raw key anywhere here is a string nobody translated.
    expect(within(menu).getByRole('menuitem', { name: 'Expand Example Skills' })).toBeTruthy()
    expect(within(menu).getByRole('menuitem', { name: 'Open the collection' })).toBeTruthy()
    expect(within(menu).getByRole('menuitem', { name: 'Copy link' })).toBeTruthy()
    expect(within(menu).getByRole('menuitem', { name: 'Copy source id' })).toBeTruthy()
    expect(within(menu).getByRole('menuitem', { name: 'Install 1 on screen' })).toBeTruthy()
    expect(within(menu).queryByText(/^hub\./)).toBeNull()
  })

  it('opens Recommendations with role chips and asks for curated entries', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    await within(container).findByText('Example Skills')

    await user.click(screen.getByRole('tab', { name: 'Recommendations' }))

    expect(
      await within(container).findByText(
        'Shortlists curated from the collections Ahabby can install — pick a role, then install what you need.',
      ),
    ).toBeTruthy()
    expect(within(container).getByRole('option', { name: 'Frontend' })).toBeTruthy()
    expect(within(container).getByRole('option', { name: 'Everyday' })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    await user.click(within(container).getByRole('option', { name: 'Frontend' }))
    expect(within(container).getByRole('option', { name: 'Frontend' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await waitFor(() => expect(ipc.getHubEntry).toHaveBeenCalled())
  })

  it('folds a whole source while keeping its heading', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    await openSource(container, 'Example Skills')
    expect(await within(container).findByText('Read and fill PDF forms.')).toBeTruthy()

    await user.click(within(container).getByRole('button', { name: 'Collapse Example Skills' }))
    await waitFor(() =>
      expect(within(container).queryByText('Read and fill PDF forms.')).toBeNull(),
    )
    expect(within(container).getByText('Example Skills')).toBeTruthy()

    await user.click(within(container).getByRole('button', { name: 'Expand Example Skills' }))
    expect(await within(container).findByText('Read and fill PDF forms.')).toBeTruthy()
  })

  it('asks only the sources that offer the chosen kind', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    await within(container).findByText('MCP Registry')

    vi.mocked(ipc.searchHub).mockClear()
    await user.click(screen.getByRole('button', { name: 'Skills' }))

    // The MCP registry is not read at all for a skills-only view — that is a tarball and a
    // request nobody asked for. Its section animates out (see `AnimatedList`) before it is gone.
    await waitFor(() => expect(within(container).queryByText('MCP Registry')).toBeNull())
    const asked = vi.mocked(ipc.searchHub).mock.calls.map(([sourceId]) => sourceId)
    expect(asked).toContain(SKILLS_SOURCE.id)
    expect(asked).not.toContain(REGISTRY_SOURCE.id)
  })

  it('filters the entries by whether the machine already holds them', async () => {
    const user = userEvent.setup()
    vi.mocked(ipc.listHubSources).mockResolvedValue({
      sources: [SKILLS_SOURCE],
      problems: [],
    })
    // One entry the machine holds, one it does not. The filter is the scan's answer, so switching
    // it narrows what is on screen without asking the collection for anything.
    const held = { ...installedEntry(), id: 'example-skills/skills/invoice', name: 'invoice' }
    vi.mocked(ipc.searchHub).mockResolvedValue(page({ entries: [entry(), held] }))

    const { container } = renderPage()
    await openSource(container, 'Example Skills')
    expect(await within(container).findByRole('button', { name: 'pdf' })).toBeTruthy()
    expect(within(container).getByRole('button', { name: 'invoice' })).toBeTruthy()

    const group = screen.getByRole('group', { name: 'Filter by installed state' })
    const asked = vi.mocked(ipc.searchHub).mock.calls.length

    // "Not installed" leaves only what is missing; the row that goes animates out first.
    await user.click(within(group).getByRole('button', { name: 'Not installed' }))
    await waitFor(() =>
      expect(within(container).queryByRole('button', { name: 'invoice' })).toBeNull(),
    )
    expect(within(container).getByRole('button', { name: 'pdf' })).toBeTruthy()

    await user.click(within(group).getByRole('button', { name: 'Installed' }))
    await waitFor(() => expect(within(container).queryByRole('button', { name: 'pdf' })).toBeNull())
    expect(within(container).getByRole('button', { name: 'invoice' })).toBeTruthy()

    expect(vi.mocked(ipc.searchHub).mock.calls.length).toBe(asked)
  })

  it('says so when the filter hides every entry it has read', async () => {
    const user = userEvent.setup()
    vi.mocked(ipc.listHubSources).mockResolvedValue({
      sources: [SKILLS_SOURCE],
      problems: [],
    })
    vi.mocked(ipc.searchHub).mockResolvedValue(page({ entries: [entry()] }))

    const { container } = renderPage()
    await openSource(container, 'Example Skills')

    const group = screen.getByRole('group', { name: 'Filter by installed state' })
    await user.click(within(group).getByRole('button', { name: 'Installed' }))

    expect(await within(container).findByText('No entries match this filter')).toBeTruthy()
  })

  it('says how much of a collection the machine already holds, out of what it has read', async () => {
    vi.mocked(ipc.listHubSources).mockResolvedValue({
      sources: [SKILLS_SOURCE],
      problems: [],
    })
    // Four entries read, one of them already on this machine: a quarter of what the section read.
    const held = { ...installedEntry(), id: 'example-skills/skills/invoice', name: 'invoice' }
    const missing = ['alpha', 'beta', 'gamma'].map((name) =>
      entry({ id: `example-skills/skills/${name}`, name }),
    )
    vi.mocked(ipc.searchHub).mockResolvedValue(page({ entries: [held, ...missing] }))

    const { container } = renderPage()
    await within(container).findByRole('heading', { name: 'Example Skills' })
    const card = cardOf(container, 'Example Skills')

    // The bar lives on the strip, so a folded collection still says where it stands.
    const bar = await within(card).findByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('25')
    expect(within(card).getByText('Installed 1 of 4 read')).toBeTruthy()

    // What the collection offers, and how it is read, are named under the heading.
    expect(within(card).getByText('Skills')).toBeTruthy()
    expect(within(card).getByText('GitHub repository')).toBeTruthy()
  })

  it('shows no progress bar for a collection it has not read', async () => {
    vi.mocked(ipc.listHubSources).mockResolvedValue({
      sources: [SKILLS_SOURCE],
      problems: [],
    })
    vi.mocked(ipc.searchHub).mockResolvedValue(
      page({ entries: [], report: report({ count: 0, total: 0 }) }),
    )

    const { container } = renderPage()
    await openSource(container, 'Example Skills')
    const card = cardOf(container, 'Example Skills')
    await within(card).findByText('Nothing here yet')

    expect(within(card).queryByRole('progressbar')).toBeNull()
  })

  it('reviews a skill and confirms the install for the chosen owner', async () => {
    const user = userEvent.setup()
    vi.mocked(ipc.listHubSources).mockResolvedValue({
      sources: [SKILLS_SOURCE],
      problems: [],
    })
    const { container } = renderPage()
    await openSource(container, 'Example Skills')

    await user.click(await within(container).findByRole('button', { name: 'Install' }))

    // The review step: every file, and the warning about what an agent may run.
    expect(await screen.findByText('What will be written')).toBeTruthy()
    expect(screen.getByText('scripts/fill.py')).toBeTruthy()
    expect(screen.getByText(/scripts the agent may run/)).toBeTruthy()
    // The owner picker offers the shared surface, then the installed agents — the pinned one
    // first — and then the project. The general case stays the default.
    const target = screen.getByRole('combobox', { name: 'Install for' })
    expect(target).toHaveTextContent('Shared')
    await user.click(target)
    const owners = await screen.findAllByRole('option')
    expect(
      owners.map((row) => row.querySelector('span[id] > span > span:last-child')?.textContent),
    ).toEqual(['Shared', 'Warp', 'Demo Agent', 'app'])

    // The list has to be closed again before the review step is read: a modal Radix select
    // hides everything else — this dialog included — from the accessibility tree.
    await user.keyboard('{Escape}')

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Install' }))

    expect(ipc.installHubResource).toHaveBeenCalledWith({
      ownerId: 'shared',
      entryId: 'example-skills/skills/pdf',
      name: null,
      transport: null,
      confirm: true,
      scan: true,
    })
  })

  it('refuses to install a server while a required value is missing', async () => {
    const user = userEvent.setup()
    vi.mocked(ipc.getHubEntry).mockResolvedValue(serverDetail())
    vi.mocked(ipc.listHubSources).mockResolvedValue({
      sources: [REGISTRY_SOURCE],
      problems: [],
    })
    const { container } = renderPage()
    await openSource(container, 'MCP Registry')

    await user.click(await within(container).findByRole('button', { name: 'Install' }))

    // The recipe is pre-filled from what the publisher declared.
    expect(await screen.findByLabelText('Command')).toHaveValue('npx')
    expect(screen.getByLabelText('Arguments')).toHaveValue('-y\n@example/files-mcp')
    expect(screen.getByText(/Required: ROOT/)).toBeTruthy()

    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Install' }))
    expect(ipc.installHubResource).not.toHaveBeenCalled()

    await user.type(within(dialog).getByLabelText('Value'), '/srv')
    await user.click(within(dialog).getByRole('button', { name: 'Install' }))

    expect(ipc.installHubResource).toHaveBeenCalledWith({
      ownerId: 'shared',
      entryId: 'mcp-registry/com.example/files',
      name: null,
      transport: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@example/files-mcp'],
        env: [{ key: 'ROOT', value: '/srv' }],
      },
      confirm: true,
      scan: true,
    })
  })

  it('opens a read-only preview from the card, and installs from it', async () => {
    const user = userEvent.setup()
    vi.mocked(ipc.listHubSources).mockResolvedValue({
      sources: [SKILLS_SOURCE],
      problems: [],
    })
    const { container } = renderPage()
    await openSource(container, 'Example Skills')

    // The body of the card is the preview: what the payload *is*, with no form and no write.
    await user.click(await within(container).findByRole('button', { name: 'pdf' }))

    expect(await screen.findByText('Instructions')).toBeTruthy()
    expect(screen.getByText('Fill the form in one pass.')).toBeTruthy()
    expect(screen.getByText('name')).toBeTruthy()
    expect(screen.getByText('scripts/fill.py')).toBeTruthy()
    expect(ipc.installHubResource).not.toHaveBeenCalled()
    expect(ipc.getHubEntry).toHaveBeenCalledWith('example-skills/skills/pdf', false)

    // …and the install dialog is one step on from there, not a separate journey.
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Install' }))
    expect(await screen.findByText('What will be written')).toBeTruthy()
  })

  it('names the owners that already hold an entry, and refuses a name that is taken', async () => {
    const user = userEvent.setup()
    vi.mocked(ipc.listHubSources).mockResolvedValue({
      sources: [SKILLS_SOURCE],
      problems: [],
    })
    vi.mocked(ipc.searchHub).mockResolvedValue(page({ entries: [installedEntry()] }))
    vi.mocked(ipc.getHubEntry).mockResolvedValue({ ...skillDetail(), entry: installedEntry() })

    const { container } = renderPage()
    await openSource(container, 'Example Skills')

    // The card says it is installed and names every owner the scan found it for — the agent-neutral
    // shared surface included, and a copy that is switched off.
    const card = await within(container).findByRole('button', { name: 'pdf' })
    expect(within(card).getByText('Installed')).toBeTruthy()
    expect(within(card).getByText('Shared')).toBeTruthy()
    expect(within(card).getByText('Demo Agent')).toBeTruthy()
    expect(
      within(card).getByRole('img', { name: /same thing the collection publishes/ }),
    ).toBeTruthy()
    expect(within(card).getByRole('img', { name: /^Switched off/ })).toBeTruthy()

    // The dialog lists them with the path each one lives at, and blocks the write the backend would
    // refuse anyway: this name, for an owner that already holds it.
    await user.click(within(container).getByRole('button', { name: 'Install' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Already installed')).toBeTruthy()
    expect(within(dialog).getByText('/home/me/.agents/skills/pdf')).toBeTruthy()
    expect(within(dialog).getByRole('alert').textContent).toContain('already taken for this owner')
    expect(within(dialog).getByRole('button', { name: 'Install' })).toBeDisabled()

    // A name of its own is a second copy, which is exactly what the form is for.
    const name = within(dialog).getByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'pdf-tools')
    await waitFor(() => expect(within(dialog).queryByRole('alert')).toBeNull())
    expect(within(dialog).getByRole('button', { name: 'Install' })).toBeEnabled()
  })

  it('compares a differing installed skill with the collection copy', async () => {
    const user = userEvent.setup()
    const differing = entry({
      installed: [
        {
          owner: { id: 'demo', name: 'Demo Agent', icon: null },
          scope: { kind: 'global' },
          path: '/home/me/.claude/skills/pdf',
          enabled: true,
          identical: false,
        },
      ],
    })
    vi.mocked(ipc.listHubSources).mockResolvedValue({
      sources: [SKILLS_SOURCE],
      problems: [],
    })
    vi.mocked(ipc.searchHub).mockResolvedValue(page({ entries: [differing] }))
    vi.mocked(ipc.getHubEntry).mockResolvedValue({ ...skillDetail(), entry: differing })
    vi.mocked(ipc.compareHubSkill).mockResolvedValue({
      entryId: differing.id,
      name: 'pdf',
      owner: { id: 'demo', name: 'Demo Agent', icon: null },
      localPath: '/home/me/.claude/skills/pdf/SKILL.md',
      published: '---\nname: pdf\n---\n# Collection\n',
      local: '---\nname: pdf\n---\n# Local edit\n',
    })

    const { container } = renderPage()
    await openSource(container, 'Example Skills')

    // The "differs" icon on the card is itself a compare shortcut.
    const card = await within(container).findByRole('button', { name: 'pdf' })
    expect(
      within(card).getByRole('button', {
        name: /Different from what the collection publishes/,
      }),
    ).toBeTruthy()

    // The preview lists an explicit Compare control for the same owner.
    await user.click(within(container).getByRole('button', { name: 'pdf' }))
    const preview = await screen.findByRole('dialog')
    await user.click(within(preview).getByRole('button', { name: 'Compare' }))
    expect(ipc.compareHubSkill).toHaveBeenCalledWith(differing.id, 'demo')
    expect(await screen.findByRole('heading', { name: 'Compare SKILL.md' })).toBeTruthy()
    expect(screen.getByText('Collection')).toBeTruthy()
    expect(screen.getByText('This copy')).toBeTruthy()
    expect(screen.getByText(/Local edit/)).toBeTruthy()

    // The card shortcut opens the same dialog. The section was left open, and an open collection is
    // kept for the session, so the second mount finds the entries without opening it again.
    cleanup()
    const again = renderPage()
    const cardAgain = await within(again.container).findByRole('button', { name: 'pdf' })
    await user.click(
      within(cardAgain).getByRole('button', {
        name: /Different from what the collection publishes/,
      }),
    )
    expect(ipc.compareHubSkill).toHaveBeenCalledTimes(2)
    expect(await screen.findByRole('heading', { name: 'Compare SKILL.md' })).toBeTruthy()
  })

  it('shows what an entry is for, and filters the sources by tag', async () => {
    const user = userEvent.setup()
    vi.mocked(ipc.searchHub).mockImplementation((sourceId) =>
      Promise.resolve(
        sourceId === SKILLS_SOURCE.id
          ? page({ entries: [entry({ tags: ['documents', 'design'] })] })
          : page({ entries: [] }),
      ),
    )
    const { container } = renderPage()
    await openSource(container, 'Example Skills')

    // The entry's own tags are on its card, next to what it is.
    const card = await within(container).findByRole('button', { name: 'pdf' })
    expect(within(card).getByText('documents')).toBeTruthy()
    expect(within(card).getByText('design')).toBeTruthy()

    // Both the card's badge and the row's chip wear the tag's own colour, hashed out of its name.
    expect(within(card).getByText('documents').className).toContain('ah-tag')
    const chip = screen.getByRole('button', { name: 'documents' })
    expect(chip.className).toContain('ah-tag')
    expect(chip.style.getPropertyValue('--ah-tag-hue')).toBe(String(tagHue('documents')))

    // The chips are the tags the source declares, so a subject can be picked without reading a
    // second collection; picking one asks the backend for it.
    vi.mocked(ipc.searchHub).mockClear()
    await user.click(screen.getByRole('button', { name: 'documents' }))

    await waitFor(() => {
      expect(vi.mocked(ipc.searchHub).mock.calls.at(-1)?.[1]).toMatchObject({
        tags: ['documents'],
      })
    })

    // …and picking a second one asks for entries carrying either.
    await user.click(screen.getByRole('button', { name: 'development' }))
    await waitFor(() => {
      expect(vi.mocked(ipc.searchHub).mock.calls.at(-1)?.[1]).toMatchObject({
        tags: ['documents', 'development'],
      })
    })
  })

  it('folds the tag row, and keeps a switched-on tag in sight', async () => {
    const user = userEvent.setup()
    const many = [
      'alpha',
      'beta',
      'gamma',
      'delta',
      'epsilon',
      'zeta',
      'eta',
      'theta',
      'iota',
      'kappa',
      'lambda',
      'mu',
    ]
    vi.mocked(ipc.listHubSources).mockResolvedValue({
      // Only the tags this test declares: the fixture's own rule would add a thirteenth, and the
      // numbers below are the point of the test.
      sources: [{ ...SKILLS_SOURCE, tags: many, tagRules: [] }],
      problems: [],
    })
    const { container } = renderPage()
    await within(container).findByText('Example Skills')

    const group = screen.getByRole('group', { name: 'Filter by tag' })
    const row = () =>
      within(group)
        .getAllByRole('button')
        .map((button) => button.textContent)
    // The row starts folded: eight tags, and how many are behind the button.
    expect(row()).toEqual([...many.slice(0, 8), 'Show 4 more'])

    // …and the whole list is one click away, in the order the sources declare it.
    await user.click(within(group).getByRole('button', { name: 'Show 4 more' }))
    await waitFor(() => expect(row()).toEqual([...many, 'Collapse']))

    // A tag picked from the full list stays in the row after it folds: it is the only chip that
    // can switch that filter off again. The chips that fold away animate out first.
    await user.click(within(group).getByRole('button', { name: 'mu' }))
    await user.click(within(group).getByRole('button', { name: 'Collapse' }))
    await waitFor(() => expect(row()).toEqual([...many.slice(0, 8), 'mu', 'Show 3 more']))
  })

  it('offers the card actions from the context menu, including re-reading the collection', async () => {
    const user = userEvent.setup()
    vi.mocked(ipc.listHubSources).mockResolvedValue({
      sources: [SKILLS_SOURCE],
      problems: [],
    })
    const { container } = renderPage()
    await openSource(container, 'Example Skills')

    fireEvent.contextMenu(await within(container).findByRole('button', { name: 'pdf' }))

    expect(await screen.findByRole('menuitem', { name: 'View' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Install' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Copy entry id' })).toBeTruthy()

    // Re-reading asks the backend to ignore its cached answer for that entry.
    vi.mocked(ipc.getHubEntry).mockClear()
    await user.click(screen.getByRole('menuitem', { name: 'Re-read from the collection' }))
    expect(ipc.getHubEntry).toHaveBeenCalledWith('example-skills/skills/pdf', true)

    fireEvent.contextMenu(await within(container).findByRole('button', { name: 'pdf' }))
    await user.click(await screen.findByRole('menuitem', { name: 'View' }))
    expect(await screen.findByText('Instructions')).toBeTruthy()
  })

  it('shows the star count of a GitHub collection, golder the more it has', async () => {
    const starred = (id: string, name: string, stars: number): HubSource => ({
      ...SKILLS_SOURCE,
      id,
      name,
      repository: `owner/${id}`,
      stars,
    })
    vi.mocked(ipc.listHubSources).mockResolvedValue({
      sources: [
        starred('quiet', 'Quiet Collection', 12),
        starred('loud', 'Loud Collection', 300_000),
        REGISTRY_SOURCE,
      ],
      problems: [],
    })
    vi.mocked(ipc.searchHub).mockResolvedValue(page())
    const { container } = renderPage()

    await within(container).findByText('Loud Collection')
    // The repository's own number, formatted for the active language, with what it means in the
    // accessibility tree — the star icon cannot say it.
    expect(within(container).getByText('300,000')).toBeTruthy()

    // The more stars, the closer the star and its number sit to the palette's gold: the chip hands
    // `.ah-stars` the share of the way, and the louder collection's is the larger one — the full
    // gold, where the quieter one is only a little of it.
    const shareOf = (name: string) => {
      const chip = within(cardOf(container, name)).getByText('Stars on GitHub').parentElement
      expect(chip?.classList.contains('ah-stars')).toBe(true)
      return Number.parseFloat(chip?.style.getPropertyValue('--ah-star-share') ?? '')
    }
    expect(shareOf('Quiet Collection')).toBeGreaterThan(0)
    expect(shareOf('Loud Collection')).toBeGreaterThan(shareOf('Quiet Collection'))
    expect(shareOf('Loud Collection')).toBe(100)

    // The MCP registry is not a GitHub repository: it carries no count, so its row shows none.
    expect(within(container).getAllByText('Stars on GitHub')).toHaveLength(2)
  })

  it('groups plugin skills and installs a selection with confirm for each', async () => {
    const user = userEvent.setup()
    vi.mocked(ipc.listHubSources).mockResolvedValue({
      sources: [SKILLS_SOURCE],
      problems: [],
    })
    const review = entry({
      id: 'example-skills/plugins/teams/skills/review',
      name: 'review',
      description: 'Review a pull request.',
      group: 'teams',
      tags: ['teams', 'review'],
      hasScripts: false,
    })
    const plan = entry({
      id: 'example-skills/plugins/teams/skills/plan',
      name: 'plan',
      description: 'Plan the work.',
      group: 'teams',
      tags: ['teams'],
      hasScripts: false,
      installed: [
        {
          owner: { id: 'shared', name: 'Shared', icon: null },
          scope: { kind: 'global' },
          path: '/home/me/.agents/skills/plan',
          enabled: true,
          identical: true,
        },
      ],
    })
    const lone = entry({
      id: 'example-skills/skills/pdf',
      name: 'pdf',
      group: null,
      hasScripts: false,
    })
    vi.mocked(ipc.searchHub).mockResolvedValue(page({ entries: [review, plan, lone] }))
    vi.mocked(ipc.installHubResource).mockImplementation((request) =>
      Promise.resolve({
        data: {
          kind: 'skill',
          entryId: request.entryId,
          owner: { id: 'shared', name: 'Shared', icon: null },
          path: `/skills/${request.entryId}`,
          filesWritten: 1,
          skill: null,
          server: null,
        },
        report: scanReport(),
      }),
    )

    const { container } = renderPage()
    await openSource(container, 'Example Skills')

    // Plugin skills share a heading with select-all / install-all; an ungrouped skill stays under
    // "Other entries". The group opens folded, so its heading and its actions are there and the
    // cards are one click away — the actions never need the cards open.
    expect(await within(container).findByText('Teams')).toBeTruthy()
    expect(within(container).getByRole('button', { name: 'Select all 2' })).toBeTruthy()
    expect(within(container).getByRole('button', { name: 'Install all' })).toBeTruthy()
    expect(within(container).getByText('Other entries')).toBeTruthy()
    expect(within(container).getByRole('button', { name: 'pdf' })).toBeTruthy()
    expect(within(container).queryByRole('button', { name: 'review' })).toBeNull()

    await user.click(within(container).getByRole('button', { name: 'Expand Teams' }))
    expect(await within(container).findByRole('button', { name: 'review' })).toBeTruthy()
    expect(within(container).getByRole('button', { name: 'plan' })).toBeTruthy()

    // Folding the group hides the cards again; Select all / Install all stay on the header.
    await user.click(within(container).getByRole('button', { name: 'Collapse Teams' }))
    await waitFor(() =>
      expect(within(container).queryByRole('button', { name: 'review' })).toBeNull(),
    )
    expect(within(container).getByRole('button', { name: 'Select all 2' })).toBeTruthy()
    await user.click(within(container).getByRole('button', { name: 'Expand Teams' }))
    expect(await within(container).findByRole('button', { name: 'review' })).toBeTruthy()

    // The group header's Select all marks both skills; the floating bar follows.
    await user.click(within(container).getByRole('button', { name: 'Select all 2' }))
    expect(await screen.findByText('2 skills selected')).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'Select review' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('checkbox', { name: 'Select plan' })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    await user.click(screen.getByRole('button', { name: 'Install selected' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Install selected skills')).toBeTruthy()
    expect(within(dialog).getByText('Already installed for this owner — skipped')).toBeTruthy()
    // plan is already on shared: only review is written.
    expect(within(dialog).getByRole('button', { name: 'Install 1 skill' })).toBeEnabled()

    await user.click(within(dialog).getByRole('button', { name: 'Install 1 skill' }))
    await waitFor(() => expect(ipc.installHubResource).toHaveBeenCalledTimes(1))
    expect(ipc.installHubResource).toHaveBeenCalledWith({
      ownerId: 'shared',
      entryId: 'example-skills/plugins/teams/skills/review',
      name: null,
      transport: null,
      confirm: true,
      scan: false,
    })
    // The batch scans the machine once when the whole set is on disk, not once per file.
    await waitFor(() => expect(ipc.rescan).toHaveBeenCalledTimes(1))
  })

  it('installs every skill of a plugin group after loading the full group', async () => {
    const user = userEvent.setup()
    vi.mocked(ipc.listHubSources).mockResolvedValue({
      sources: [SKILLS_SOURCE],
      problems: [],
    })
    const review = entry({
      id: 'example-skills/plugins/teams/skills/review',
      name: 'review',
      description: 'Review a pull request.',
      group: 'teams',
      tags: ['teams'],
      hasScripts: false,
    })
    const plan = entry({
      id: 'example-skills/plugins/teams/skills/plan',
      name: 'plan',
      description: 'Plan the work.',
      group: 'teams',
      tags: ['teams'],
      hasScripts: false,
    })
    // The first page only has one of the two; Install all asks again with the group tag.
    vi.mocked(ipc.searchHub).mockImplementation((_sourceId, query) => {
      if (query.tags?.includes('teams')) {
        return Promise.resolve(page({ entries: [review, plan] }))
      }
      return Promise.resolve(page({ entries: [review] }))
    })
    vi.mocked(ipc.installHubResource).mockImplementation((request) =>
      Promise.resolve({
        data: {
          kind: 'skill',
          entryId: request.entryId,
          owner: { id: 'shared', name: 'Shared', icon: null },
          path: `/skills/${request.entryId}`,
          filesWritten: 1,
          skill: null,
          server: null,
        },
        report: scanReport(),
      }),
    )

    const { container } = renderPage()
    await openSource(container, 'Example Skills')
    await within(container).findByText('Teams')

    await user.click(within(container).getByRole('button', { name: 'Install all' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Install “Teams”')).toBeTruthy()
    expect(within(dialog).getByText('review')).toBeTruthy()
    expect(within(dialog).getByText('plan')).toBeTruthy()

    await user.click(within(dialog).getByRole('button', { name: 'Install 2 skills' }))
    await waitFor(() => expect(ipc.installHubResource).toHaveBeenCalledTimes(2))
    expect(vi.mocked(ipc.installHubResource).mock.calls.map(([request]) => request)).toEqual([
      {
        ownerId: 'shared',
        entryId: 'example-skills/plugins/teams/skills/review',
        name: null,
        transport: null,
        confirm: true,
        scan: false,
      },
      {
        ownerId: 'shared',
        entryId: 'example-skills/plugins/teams/skills/plan',
        name: null,
        transport: null,
        confirm: true,
        scan: false,
      },
    ])
    await waitFor(() => expect(ipc.rescan).toHaveBeenCalledTimes(1))
  })

  it('mounts a long collection a batch at a time and grows it as the sentinel comes into view', async () => {
    const collection = Array.from({ length: 60 }, (_, index) =>
      entry({
        id: `example-skills/skills/skill-${index}`,
        name: `skill-${index}`,
        description: `Skill number ${index}.`,
      }),
    )
    vi.mocked(ipc.listHubSources).mockResolvedValue({
      sources: [SKILLS_SOURCE],
      problems: [],
    })
    vi.mocked(ipc.searchHub).mockResolvedValue(
      page({ entries: collection, report: report({ count: 60, total: 60 }) }),
    )

    const { container } = renderPage()
    await openSource(container, 'Example Skills')
    await within(container).findByText('skill-0')

    // One batch, not the whole collection: the rows nobody is looking at stay unmounted.
    expect(mountedRows(container)).toBe(24)
    expect(within(container).queryByText('skill-24')).toBeNull()

    act(() => FakeIntersectionObserver.latest().intersect())
    expect(mountedRows(container)).toBe(48)
    expect(within(container).getByText('skill-24')).toBeTruthy()
  })

  it('shows card-shaped placeholders while a collection is being read', async () => {
    vi.mocked(ipc.listHubSources).mockResolvedValue({
      sources: [SKILLS_SOURCE],
      problems: [],
    })
    // A request that never answers: the pending state held still for the assertion.
    vi.mocked(ipc.searchHub).mockReturnValue(new Promise<HubPageResult>(() => {}))

    const { container } = renderPage()
    // The source is known and its collection is not: the section is opened, and the placeholders
    // under its heading carry the shape of the cards.
    await openSource(container, 'Example Skills')

    expect(mountedRows(container)).toBe(3)
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy()
    expect(within(container).queryByText('skill-0')).toBeNull()
  })

  it('grows the list with placeholders while the next page of a collection is read', async () => {
    const user = userEvent.setup()
    vi.mocked(ipc.listHubSources).mockResolvedValue({
      sources: [SKILLS_SOURCE],
      problems: [],
    })
    vi.mocked(ipc.searchHub)
      .mockResolvedValueOnce(
        page({ entries: [entry()], report: report({ count: 1, total: 40, nextCursor: 'page-2' }) }),
      )
      // The second page never answers: the pending state held still for the assertion.
      .mockReturnValueOnce(new Promise<HubPageResult>(() => {}))

    const { container } = renderPage()
    await openSource(container, 'Example Skills')
    await within(container).findByRole('button', { name: 'pdf' })

    await user.click(within(container).getByRole('button', { name: 'Load more' }))

    // The rows already read stay where they are and the ones being read announce themselves under
    // them, in the shape of the cards they will become.
    expect(within(container).getByRole('button', { name: 'pdf' })).toBeTruthy()
    expect(within(container).queryByRole('button', { name: 'Load more' })).toBeNull()
    expect(mountedRows(container)).toBe(3)
  })

  it('wears its own shape while the list of sources is being read', () => {
    // A request that never answers: the pending state held still for the assertion.
    vi.mocked(ipc.listHubSources).mockReturnValue(new Promise<HubSourceCatalog>(() => {}))

    const { container } = renderPage()

    // No source is known yet, so the page is the shape of one — the heading, the toolbar and the
    // collections to come — and not an empty screen the sources then move: two collections' worth
    // of placeholder cards, six rows and no source of the page's own run among them.
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy()
    expect(container.querySelectorAll('.ah-card-group > *')).toHaveLength(6)
    expect(within(container).queryByText('Example Skills')).toBeNull()
  })
})
