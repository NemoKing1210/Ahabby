import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ipc } from '@/shared/api/ipc'
import type { AgentRef } from '@/shared/bindings/AgentRef'
import type { Library } from '@/shared/bindings/Library'
import type { McpServer } from '@/shared/bindings/McpServer'
import type { OtherResource } from '@/shared/bindings/OtherResource'
import type { Skill } from '@/shared/bindings/Skill'
import { SHARED_OWNER_ID } from '@/shared/lib/owners'
import { renderWithProviders } from '@/test/render'

import { LibraryPage } from './LibraryPage'
import { testSettings } from '@/test/fixtures'

// The stub has to be published before `lazyRows` is imported, which a hoisted callback does — see
// `@/test/intersectionObserver` for why the module is reached through a dynamic import.
const { FakeIntersectionObserver } = await vi.hoisted(async () => {
  const stub = await import('@/test/intersectionObserver')
  stub.installFakeIntersectionObserver()
  return { FakeIntersectionObserver: stub.FakeIntersectionObserver }
})

vi.mock('@/shared/api/ipc', () => ({
  ipc: { listLibrary: vi.fn(), getSettings: vi.fn() },
}))

// Radix opens the list on pointerdown and scrolls the active row into view; jsdom has neither
// pointer capture nor `scrollIntoView` (see `shared/ui/Select.test.tsx`).
Element.prototype.hasPointerCapture = () => false
Element.prototype.setPointerCapture = () => {}
Element.prototype.releasePointerCapture = () => {}
Element.prototype.scrollIntoView = () => {}

vi.mock('@/features/agents/api/scan', () => ({
  useScanRefresh: () => ({
    isScanning: false,
    scanning: new Set<string>(),
    landed: new Set<string>(),
    progress: { done: 0, total: 0 },
    rescan: vi.fn(),
  }),
}))

const claude: AgentRef = { id: 'claude-code', name: 'Claude Code', icon: 'claude' }
const opencode: AgentRef = { id: 'opencode', name: 'OpenCode', icon: 'opencode' }
/** The agent-neutral surface: a resource that belongs to no single agent. */
const shared: AgentRef = { id: SHARED_OWNER_ID, name: 'Shared' }

function skill(name: string, path: string, agents: AgentRef[], extra: Partial<Skill> = {}): Skill {
  return {
    id: `${name}#${path}`,
    name,
    description: `about ${name}`,
    path,
    entryPath: `${path}/SKILL.md`,
    scope: { kind: 'global' },
    agents,
    frontmatter: [],
    tags: [],
    content: '# body',
    sizeBytes: 10,
    enabled: true,
    removable: true,
    unverified: false,
    ...extra,
  }
}

const SERVER: McpServer = {
  id: 'github#/a/.mcp.json',
  name: 'github',
  transport: { type: 'stdio', command: 'npx', args: ['-y'] },
  scope: { kind: 'global' },
  agent: claude,
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
}

const SERVER_HTTP: McpServer = {
  ...SERVER,
  id: 'remote#/b/.mcp.json',
  name: 'remote',
  transport: { type: 'http', url: 'https://mcp.example.com', protocol: 'http' },
  sourceConfig: '/b/.mcp.json',
  keyPath: ['mcpServers', 'remote'],
}

const RESOURCE: OtherResource = {
  id: 'claude-code.instructions.1',
  kind: 'instructions',
  label: 'CLAUDE.md',
  path: '/a/CLAUDE.md',
  agent: claude,
  scope: { kind: 'global' },
  format: 'markdown',
  description: null,
  content: null,
  sizeBytes: 20,
  isDirectory: false,
  exists: true,
  itemCount: null,
  unverified: false,
}

const LIBRARY: Library = {
  skills: [
    skill('pdf', '/a/pdf', [claude, opencode], {
      createdMs: Date.UTC(2025, 9, 1),
      modifiedMs: Date.UTC(2025, 9, 2),
      tags: ['documents', 'forms'],
    }),
    skill('review', '/a/review', [claude]),
    // Agent-neutral, and the filesystem reported a modification time only.
    skill('global', '/agents/skills/global', [shared], {
      createdMs: null,
      modifiedMs: Date.UTC(2025, 8, 3),
    }),
  ],
  mcpServers: [SERVER, SERVER_HTTP],
  other: [RESOURCE],
  stats: { agents: 2, installedAgents: 2, skills: 3, mcpServers: 2, other: 1 },
  scannedAtMs: Date.now() - 60_000,
  problems: [],
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderWithProviders(
    <QueryClientProvider client={client}>
      <LibraryPage />
    </QueryClientProvider>,
  )
}

/**
 * The skill cards actually mounted — one switch each, which is what `useLazyRows` bounds. The
 * entries behind the ones on screen are the query's data, not the list's markup.
 */
function mountedCards(container: HTMLElement): number {
  return container.querySelectorAll('[role="switch"]').length
}

const SETTINGS = testSettings()

/**
 * Agent brand marks ship an SVG `<title>` with the agent name, which `getByText` would count
 * as a second match for every tag — ignore it and query the visible labels only.
 */
const TEXT = { ignore: 'script, style, title' } as const

describe('LibraryPage', () => {
  beforeEach(() => {
    FakeIntersectionObserver.reset()
    vi.mocked(ipc.listLibrary).mockResolvedValue(LIBRARY)
    vi.mocked(ipc.getSettings).mockResolvedValue(SETTINGS)
  })

  // RTL auto-cleanup is not configured here (see AGENTS.md), and an open select leaves its
  // listbox — and `pointer-events: none` on the body — behind for the next case.
  afterEach(() => {
    cleanup()
    document.body.style.removeProperty('pointer-events')
  })

  it('heads a shared name and leaves a one-agent name in the plain list', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    // The shared name is a group, so it starts folded: its heading is there, its cards are not.
    await within(container).findByRole('heading', { name: 'pdf' })
    expect(within(container).queryByRole('button', { name: 'pdf' })).toBeNull()

    // `review` belongs to a single agent, so it needs no heading of its own — and no fold.
    expect(within(container).queryByRole('heading', { name: 'review' })).toBeNull()
    expect(within(container).getAllByRole('button', { name: 'review' })).toHaveLength(1)

    await user.click(within(container).getByRole('button', { name: 'Expand pdf' }))
    const pdf = await within(container).findByRole('button', { name: 'pdf' })
    const review = within(container).getByRole('button', { name: 'review' })
    expect(within(pdf).getAllByText('Claude Code', TEXT).length).toBeGreaterThan(0)
    expect(within(pdf).getAllByText('OpenCode', TEXT).length).toBeGreaterThan(0)
    // The solo skill does not pretend to belong to the agent that does not own it.
    expect(within(review).queryByText('OpenCode', TEXT)).toBeNull()
  })

  it('lists a shared skill under each agent when grouped by agent', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    await within(container).findByRole('heading', { name: 'pdf' })

    await user.click(within(container).getByRole('button', { name: 'Agent' }))

    expect(within(container).getByRole('heading', { name: 'Claude Code' })).toBeTruthy()
    expect(within(container).getByRole('heading', { name: 'OpenCode' })).toBeTruthy()
    expect(within(container).queryByRole('heading', { name: 'pdf' })).toBeNull()

    // Each owner's block is a group of its own, so it starts folded too; the shared skill is
    // under both of them once they are opened.
    await user.click(within(container).getByRole('button', { name: 'Expand Claude Code' }))
    await user.click(within(container).getByRole('button', { name: 'Expand OpenCode' }))
    expect(await within(container).findAllByText('/a/pdf')).toHaveLength(2)
  })

  it('narrows every tab with the search box', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    await within(container).findByRole('heading', { name: 'pdf' })

    await user.type(within(container).getByRole('textbox', { name: 'Search' }), 'review')

    expect(within(container).getAllByRole('button', { name: 'review' })).toHaveLength(1)
    expect(within(container).queryByRole('button', { name: 'pdf' })).toBeNull()
    expect(within(container).getByRole('tab', { name: /^Skills/ })).toHaveTextContent('1')
  })

  it('offers the tags the skills declare and narrows the list by them', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    await within(container).findByRole('heading', { name: 'pdf' })

    // The row is a view of this library: a tag no skill declares is not offered.
    expect(within(container).queryByRole('button', { name: 'testing' })).toBeNull()
    const documents = within(container).getByRole('button', { name: 'documents' })
    expect(documents).toHaveAttribute('aria-pressed', 'false')

    await user.click(documents)

    // Only the skill whose own `SKILL.md` declares the tag is left, and the badge follows.
    expect(within(container).getByRole('heading', { name: 'pdf' })).toBeTruthy()
    expect(within(container).queryByRole('button', { name: 'review' })).toBeNull()
    expect(within(container).getByRole('tab', { name: /^Skills/ })).toHaveTextContent('1')
    expect(within(container).getByRole('button', { name: 'documents' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    // A chip is a switch, so the same click puts the rest of the library back.
    await user.click(within(container).getByRole('button', { name: 'documents' }))
    expect(within(container).getAllByRole('button', { name: 'review' })).toHaveLength(1)
  })

  it('wears a skill’s own tags on its card', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    await within(container).findByRole('heading', { name: 'pdf' })

    await user.click(within(container).getByRole('button', { name: 'Expand pdf' }))
    const pdf = await within(container).findByRole('button', { name: 'pdf' })

    expect(within(pdf).getByText('documents')).toBeTruthy()
    expect(within(pdf).getByText('forms')).toBeTruthy()
    // A skill that declares none shows no tag at all, rather than an empty row.
    const review = within(container).getByRole('button', { name: 'review' })
    expect(within(review).queryByText('documents')).toBeNull()
  })

  it('shows the MCP servers with their owning agent', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    await within(container).findByRole('heading', { name: 'pdf' })

    await user.click(within(container).getByRole('tab', { name: /^MCP/ }))

    expect(within(container).getByText('npx')).toBeTruthy()
    // The skills panel is gone, so the owner tag can only come from the server card.
    expect(within(container).queryByRole('button', { name: 'pdf' })).toBeNull()
    expect(within(container).getAllByText('Claude Code', TEXT).length).toBeGreaterThan(0)
  })

  it('offers the pinned agents first in the agent filter', async () => {
    vi.mocked(ipc.getSettings).mockResolvedValue({ ...SETTINGS, favoriteAgents: ['opencode'] })
    const user = userEvent.setup()
    const { container } = renderPage()
    await within(container).findByRole('heading', { name: 'pdf' })

    await user.click(within(container).getByRole('combobox', { name: 'Agent' }))

    // Radix drops `className` on its text node, so the label is the wrapper's own last child.
    const rows = await screen.findAllByRole('option')
    expect(
      rows.map((row) => row.querySelector('span[id] > span > span:last-child')?.textContent),
    ).toEqual(['All', 'OpenCode', 'Claude Code', 'Shared'])
  })

  it('offers a way out of a dead-end filter', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    await within(container).findByRole('heading', { name: 'pdf' })

    await user.type(within(container).getByRole('textbox', { name: 'Search' }), 'nothing here')

    expect(within(container).getByText('No results for “nothing here”')).toBeTruthy()
    const clear = within(container).getAllByRole('button', { name: 'Clear filters' })[0]
    expect(clear).toBeDefined()
    if (clear) await user.click(clear)

    expect(within(container).getByRole('heading', { name: 'pdf' })).toBeTruthy()
  })

  it('labels the agent-neutral surface and files it under its own group', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    await within(container).findByRole('heading', { name: 'pdf' })

    // Grouped by name, the global skill carries the shared tag (translated, not the
    // backend's "Shared" display name).
    const global = within(container).getByRole('button', { name: 'global' })
    expect(within(global).getAllByText('Shared', TEXT).length).toBeGreaterThan(0)

    await user.click(within(container).getByRole('button', { name: 'Agent' }))

    // Grouped by owner, the shared resources get their own section.
    expect(within(container).getByRole('heading', { name: 'Shared' })).toBeTruthy()
    expect(within(container).getByRole('heading', { name: 'Claude Code' })).toBeTruthy()
  })

  it('narrows a tab with its own facet chips', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    await within(container).findByRole('heading', { name: 'pdf' })

    await user.click(within(container).getByRole('tab', { name: /^MCP/ }))
    expect(within(container).getByText('npx')).toBeTruthy()
    expect(within(container).getByText('https://mcp.example.com')).toBeTruthy()

    // The chip carries the number of matching servers, so its name is unambiguous.
    await user.click(within(container).getByRole('button', { name: 'http 1' }))

    expect(within(container).getByText('https://mcp.example.com')).toBeTruthy()
    // The row that leaves animates out first (see `AnimatedList`), so it is gone a moment later.
    await waitFor(() => expect(within(container).queryByText('npx')).toBeNull())
  })

  it('narrows a tab to the resources that are switched off', async () => {
    vi.mocked(ipc.listLibrary).mockResolvedValue({
      ...LIBRARY,
      skills: [...LIBRARY.skills, skill('parked', '/a/parked', [claude], { enabled: false })],
    })
    const user = userEvent.setup()
    const { container } = renderPage()
    await within(container).findByRole('heading', { name: 'pdf' })

    // The row counts what each choice would show, so "Off 0" cannot look like a filter that
    // does nothing.
    const activity = within(container).getByRole('group', { name: 'Activity' })
    expect(within(activity).getByRole('button', { name: 'All 4' })).toBeTruthy()
    expect(within(activity).getByRole('button', { name: 'On 3' })).toBeTruthy()
    expect(within(activity).getByRole('button', { name: 'Off 1' })).toBeTruthy()

    await user.click(within(activity).getByRole('button', { name: 'Off 1' }))
    expect(within(container).getByRole('button', { name: 'parked' })).toBeTruthy()
    expect(within(container).queryByRole('heading', { name: 'pdf' })).toBeNull()
    // Narrowing this tab does not empty the others: their badges keep their own counts.
    expect(within(container).getByRole('tab', { name: /^MCP/ })).toHaveTextContent('2')

    await user.click(within(activity).getByRole('button', { name: 'All 4' }))
    expect(within(container).getByRole('heading', { name: 'pdf' })).toBeTruthy()
    expect(within(container).getByRole('button', { name: 'parked' })).toBeTruthy()
  })

  it('shows the file date each resource carries, and labels it honestly', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    await within(container).findByRole('heading', { name: 'pdf' })

    await user.click(within(container).getByRole('button', { name: 'Expand pdf' }))
    const pdf = await within(container).findByRole('button', { name: 'pdf' })
    expect(within(pdf).getByText(/^Created /)).toBeTruthy()

    // The shared skill has no creation time, so its card falls back to the modification
    // time rather than calling it "created".
    const global = within(container).getByRole('button', { name: 'global' })
    expect(within(global).getByText(/^Modified /)).toBeTruthy()
    expect(within(global).queryByText(/^Created /)).toBeNull()
  })

  it('offers a context menu on an "Other" resource card', async () => {
    const user = userEvent.setup()
    const view = renderPage()
    const { container } = view
    await within(container).findByRole('heading', { name: 'pdf' })

    await user.click(within(container).getByRole('tab', { name: /^Other/ }))
    fireEvent.contextMenu(within(container).getByText('CLAUDE.md'), { clientX: 40, clientY: 60 })

    const menu = within(await screen.findByRole('menu'))
    expect(menu.getByRole('menuitem', { name: 'Edit' })).toBeTruthy()
    expect(menu.getByRole('menuitem', { name: 'Copy path' })).toBeTruthy()
    expect(menu.getByRole('menuitem', { name: 'Show in file manager' })).toBeTruthy()

    view.unmount()
  })

  it('opens a skill group from its own heading, and folds it away again', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    // The list is a run of headings until a group is opened — the library is long, so the
    // headings are what it opens on.
    await within(container).findByRole('heading', { name: 'pdf' })
    expect(within(container).queryByRole('button', { name: 'pdf' })).toBeNull()
    expect(within(container).getByRole('button', { name: 'Expand pdf' })).toBeTruthy()

    await user.click(within(container).getByRole('button', { name: 'Expand pdf' }))
    expect(await within(container).findByRole('button', { name: 'pdf' })).toBeTruthy()

    await user.click(within(container).getByRole('button', { name: 'Collapse pdf' }))

    // The cards leave and the heading stays — it is the control that brings them back.
    await waitFor(() => expect(within(container).queryByRole('button', { name: 'pdf' })).toBeNull())
    expect(within(container).getByRole('heading', { name: 'pdf' })).toBeTruthy()
    expect(within(container).getByRole('button', { name: 'Expand pdf' })).toBeTruthy()
  })

  it('wears one card per group, with the cards on it', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    const heading = await within(container).findByRole('heading', { name: 'pdf' })

    // Folded away the group is that card alone — the strip, and nothing hanging under it.
    const card = heading.closest('section')
    expect(card).not.toBeNull()
    expect(within(card as HTMLElement).queryByRole('button', { name: 'pdf' })).toBeNull()

    await user.click(within(container).getByRole('button', { name: 'Expand pdf' }))

    // Opened, its cards are still inside the same surface: a group is one card of the list — the
    // strip on top, the skills on the canvas it frames — not a heading with a list beside it.
    expect(await within(card as HTMLElement).findByRole('button', { name: 'pdf' })).toBeTruthy()
  })

  it('says where a group lives, and offers the group its own menu on the strip', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    const heading = await within(container).findByRole('heading', { name: 'pdf' })
    const card = heading.closest('section')
    expect(card).not.toBeNull()

    // A folded group still answers what a folded list is read for: where the thing lives.
    expect(within(card as HTMLElement).getByText('/a')).toBeTruthy()

    fireEvent.contextMenu(heading, { clientX: 30, clientY: 40 })
    const menu = within(await screen.findByRole('menu'))
    expect(menu.getByRole('menuitem', { name: 'Show in file manager' })).toBeTruthy()
    expect(menu.getByRole('menuitem', { name: 'Copy path' })).toBeTruthy()

    // The menu's fold action is the heading's own, so the group opens from the right click too.
    await user.click(menu.getByRole('menuitem', { name: 'Expand pdf' }))
    expect(await within(container).findByRole('button', { name: 'pdf' })).toBeTruthy()
  })

  it('counts what a group holds switched off', async () => {
    vi.mocked(ipc.listLibrary).mockResolvedValue({
      ...LIBRARY,
      skills: [...LIBRARY.skills, skill('pdf', '/b/pdf', [opencode], { enabled: false })],
    })
    const { container } = renderPage()
    const heading = await within(container).findByRole('heading', { name: 'pdf' })
    const card = heading.closest('section')
    expect(card).not.toBeNull()

    // Two skills share the name and one of them is off: the folded group says so, and says where
    // each copy lives.
    expect(within(card as HTMLElement).getByText('Off 1')).toBeTruthy()
    expect(within(card as HTMLElement).getByText('/b')).toBeTruthy()
  })

  it('leaves a card inside a group a menu of its own', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    await within(container).findByRole('heading', { name: 'pdf' })
    await user.click(within(container).getByRole('button', { name: 'Expand pdf' }))

    const pdf = await within(container).findByRole('button', { name: 'pdf' })
    fireEvent.contextMenu(pdf, { clientX: 30, clientY: 40 })

    // The card's own menu, never the group's: that one belongs to the strip above it.
    const menu = within(await screen.findByRole('menu'))
    expect(menu.getByRole('menuitem', { name: 'Open' })).toBeTruthy()
    expect(menu.queryByRole('menuitem', { name: 'Expand pdf' })).toBeNull()
  })

  it('keeps an opened group open across a tab switch, and folds each grouping on its own', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    await within(container).findByRole('heading', { name: 'pdf' })

    await user.click(within(container).getByRole('button', { name: 'Expand pdf' }))
    expect(await within(container).findByRole('button', { name: 'pdf' })).toBeTruthy()

    await user.click(within(container).getByRole('tab', { name: /^MCP/ }))
    await user.click(within(container).getByRole('tab', { name: /^Skills/ }))
    // The fold is a session filter like the ones around it: the list comes back as it was left.
    expect(within(container).getByRole('button', { name: 'pdf' })).toBeTruthy()

    // Grouping by agent is a list of its own, so its groups are folded again.
    await user.click(within(container).getByRole('button', { name: 'Agent' }))
    expect(within(container).queryByRole('button', { name: 'pdf' })).toBeNull()
    expect(within(container).getByRole('button', { name: 'Expand Claude Code' })).toBeTruthy()
  })

  it('mounts one batch of a long library and grows it as the sentinel comes into view', async () => {
    vi.mocked(ipc.listLibrary).mockResolvedValue({
      ...LIBRARY,
      skills: Array.from({ length: 60 }, (_, index) =>
        // Zero-padded, so the names sort in the order they are numbered and the batch is a prefix.
        skill(`skill-${String(index).padStart(2, '0')}`, `/p/skill-${index}`, [claude]),
      ),
    })

    const { container } = renderPage()
    await within(container).findByText('skill-00')

    // One batch, not the whole library: the cards nobody is looking at stay unmounted — a card is
    // its own component with its own menu and switch, and a library is everything this machine
    // holds. The names here are one-of-a-kind, so the batch is the plain run under the headed ones.
    expect(mountedCards(container)).toBe(24)
    expect(within(container).queryByText('skill-24')).toBeNull()

    act(() => FakeIntersectionObserver.latest().intersect())

    expect(mountedCards(container)).toBe(48)
    expect(within(container).getByText('skill-24')).toBeTruthy()
  })

  it('keeps every heading with the cards under it when the batch cuts a group', async () => {
    const user = userEvent.setup()
    vi.mocked(ipc.listLibrary).mockResolvedValue({
      ...LIBRARY,
      skills: [
        // More than one batch of one shared name, then a group past the cut.
        ...Array.from({ length: 40 }, (_, index) =>
          skill('pdf', `/p/pdf-${index}`, [claude, opencode]),
        ),
        skill('zzz', '/p/zzz-a', [claude, opencode]),
      ],
    })

    const { container } = renderPage()
    await within(container).findByRole('heading', { name: 'pdf' })
    // The batch is spent on the rows the list mounts, so a folded group costs it nothing — this
    // group is opened here to watch the budget land inside it.
    await user.click(within(container).getByRole('button', { name: 'Expand pdf' }))
    await waitFor(() => expect(mountedCards(container)).toBe(24))

    // The group the batch lands inside is cut, not broken: its heading is there with the cards it
    // heads, and a group past the cut is not headed at all — a heading over nothing reads as an
    // empty group rather than as one more to come.
    expect(within(container).getByRole('heading', { name: 'pdf' })).toBeTruthy()
    expect(within(container).queryByRole('heading', { name: 'zzz' })).toBeNull()

    act(() => FakeIntersectionObserver.latest().intersect())

    // The next batch reaches the second group: its heading is there, and it stays folded until it
    // is opened — a folded group is one row, which is what lets the batch get past it.
    expect(within(container).getByRole('heading', { name: 'zzz' })).toBeTruthy()
    expect(mountedCards(container)).toBe(40)

    await user.click(within(container).getByRole('button', { name: 'Expand zzz' }))
    expect(await within(container).findByRole('button', { name: 'zzz' })).toBeTruthy()
  })

  it('lets the batch through to the list under a group that is folded away', async () => {
    const user = userEvent.setup()
    vi.mocked(ipc.listLibrary).mockResolvedValue({
      ...LIBRARY,
      skills: [
        // A shared name with more cards than one batch, then one-of-a-kind names under it.
        ...Array.from({ length: 40 }, (_, index) =>
          skill('pdf', `/p/pdf-${index}`, [claude, opencode]),
        ),
        ...Array.from({ length: 30 }, (_, index) =>
          skill(`zzz-${String(index).padStart(2, '0')}`, `/p/zzz-${index}`, [claude]),
        ),
      ],
    })

    const { container } = renderPage()
    await within(container).findByRole('heading', { name: 'pdf' })

    // The group opens folded, so the batch is already through to the list under it: counting the
    // cards it hides would leave those 30 names unmounted behind a heading nobody opened.
    await waitFor(() => expect(mountedCards(container)).toBe(23))
    expect(within(container).getByText('zzz-00')).toBeTruthy()

    // Opening it spends the batch inside the group instead, and folding it away gives the list
    // under it back.
    await user.click(within(container).getByRole('button', { name: 'Expand pdf' }))
    await waitFor(() => expect(mountedCards(container)).toBe(24))
    expect(within(container).queryByText('zzz-00')).toBeNull()

    await user.click(within(container).getByRole('button', { name: 'Collapse pdf' }))
    await waitFor(() => expect(mountedCards(container)).toBe(23))
    expect(within(container).getByText('zzz-00')).toBeTruthy()
  })
})
