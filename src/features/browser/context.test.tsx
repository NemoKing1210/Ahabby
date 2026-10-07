import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ipc } from '@/shared/api/ipc'
import type { WebPage } from '@/shared/bindings/WebPage'
import { Markdown } from '@/shared/ui/Markdown'
import { renderWithProviders } from '@/test/render'

import { clearProxiedImages } from './lib/images'

vi.mock('@/shared/api/ipc', () => ({
  ipc: { fetchWebPage: vi.fn(), fetchWebImage: vi.fn(), openUrl: vi.fn() },
}))

const GUIDE = 'https://docs.example.com/guide'

/** A page with a heading, a link to another page of the same site, and a diagram. */
const GUIDE_PAGE: WebPage = {
  url: GUIDE,
  kind: 'html',
  truncated: false,
  body: `<!doctype html><html><head><title>Getting started — Example Docs</title></head><body>
    <nav>the site's own navigation</nav>
    <article>
      <h1>Getting started</h1>
      <p>${'Read this first. '.repeat(20)}</p>
      <p><img src="./diagram.png" alt="Diagram" width="400"></p>
      <p><a href="/install">Install it</a></p>
    </article>
    <footer>the site's own footer</footer>
  </body></html>`,
}

const INSTALL_PAGE: WebPage = {
  url: 'https://docs.example.com/install',
  kind: 'html',
  truncated: false,
  body: `<body><article><h1>Installing</h1><p>${'One command. '.repeat(20)}</p></article></body>`,
}

/** A document of the app, with one link in it — the shape `USER.md` and a `SKILL.md` have. */
function withLink(href: string, label = 'the docs') {
  return renderWithProviders(<Markdown source={`See [${label}](${href}) for more.`} />)
}

async function openReader(href = GUIDE) {
  const view = withLink(href)
  await userEvent.setup().click(screen.getByRole('link', { name: 'the docs' }))
  const dialog = await screen.findByRole('dialog')
  return { view, dialog }
}

beforeEach(() => {
  clearProxiedImages()
  vi.mocked(ipc.fetchWebPage).mockResolvedValue(GUIDE_PAGE)
  vi.mocked(ipc.fetchWebImage).mockResolvedValue({ mime: 'image/png', base64: 'AAAA' })
})

afterEach(() => {
  // RTL's auto-cleanup is not configured in this project, and a dialog left in the document
  // would answer the next case's `findByRole('dialog')`.
  cleanup()
  vi.clearAllMocks()
})

describe("Ahabby's own browser", () => {
  it('reads a link of a document instead of letting the window navigate', async () => {
    const { dialog } = await openReader()

    expect(ipc.fetchWebPage).toHaveBeenCalledWith(GUIDE)
    // The page's own title heads the window, its article is what is shown, and its address is
    // in the bar — while the chrome the article replaced is nowhere.
    expect(within(dialog).getByText('Getting started — Example Docs')).toBeTruthy()
    expect(within(dialog).getByRole('heading', { name: 'Getting started' })).toBeTruthy()
    expect(within(dialog).getByDisplayValue(GUIDE)).toBeTruthy()
    expect(within(dialog).queryByText(/the site's own navigation/)).toBeNull()
  })

  it('carries the images of the page through the backend', async () => {
    const { dialog } = await openReader()

    const image = await within(dialog).findByAltText('Diagram')
    await waitFor(() => {
      expect(ipc.fetchWebImage).toHaveBeenCalledWith('https://docs.example.com/diagram.png')
    })
    await waitFor(() => expect(image.getAttribute('src')).toBe('data:image/png;base64,AAAA'))
  })

  it('opens a link inside the page in the same window, and goes back to where it was', async () => {
    vi.mocked(ipc.fetchWebPage).mockImplementation((url) =>
      Promise.resolve(url === INSTALL_PAGE.url ? INSTALL_PAGE : GUIDE_PAGE),
    )
    await openReader()
    const user = userEvent.setup()

    // A new address is a new window (the dialog is keyed by it), so the old one must not be
    // queried again: the reader is looked up the way a user looks at it — on the screen.
    await user.click(within(screen.getByRole('dialog')).getByRole('link', { name: 'Install it' }))
    expect(await screen.findByRole('heading', { name: 'Installing' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('heading', { name: 'Getting started' })).toBeTruthy()
  })

  it('takes an address typed into the address bar', async () => {
    const user = userEvent.setup()
    const { dialog } = await openReader()
    const address = within(dialog).getByLabelText('Address')

    await user.clear(address)
    await user.type(address, 'example.org{Enter}')

    await waitFor(() => expect(ipc.fetchWebPage).toHaveBeenCalledWith('https://example.org/'))
  })

  /**
   * The two links the reader must not touch: the router owns the hash, and a scheme no desktop
   * app can honour is refused rather than followed.
   */
  it('leaves an in-app hash link alone, and refuses one it cannot open', async () => {
    const view = renderWithProviders(
      <div>
        <a href="#/agents">Agents</a>
        <a href="mailto:hello@example.com">the team</a>
      </div>,
    )
    const user = userEvent.setup()

    await user.click(within(view.container).getByText('Agents'))
    await user.click(within(view.container).getByText('the team'))

    expect(ipc.fetchWebPage).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
