import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { renderWithProviders } from '@/test/render'

import { AgentIcon } from './AgentIcon'
import { AGENT_BRANDS } from './agentBrands'

const BUILTIN_CATALOG = join(process.cwd(), 'src-tauri/catalog/builtin')

function tileOf(container: HTMLElement): HTMLElement {
  const tile = container.firstElementChild
  if (!(tile instanceof HTMLElement)) {
    throw new Error('AgentIcon rendered no tile')
  }
  return tile
}

describe('AgentIcon', () => {
  it('paints the brand tile and the brand mark', () => {
    const { container } = renderWithProviders(<AgentIcon name="Claude Code" icon="claude" />)
    const tile = tileOf(container)

    expect(tile.style.backgroundColor).toBe('rgb(9, 9, 11)')
    expect(tile.style.color).toBe('rgb(217, 119, 87)')
    expect(tile.querySelector('svg')?.children.length).toBeGreaterThan(0)
  })

  it('shows initials on the brand tile for agents without a mark', () => {
    const { container } = renderWithProviders(<AgentIcon name="Zed" icon="zed" />)
    const tile = tileOf(container)

    expect(tile.style.backgroundColor).toBe('rgb(19, 72, 220)')
    expect(tile.querySelector('svg')).toBeNull()
    expect(tile.textContent).toBe('Z')
  })

  it('falls back to a neutral monogram for an unmapped or missing icon key', () => {
    const unknown = renderWithProviders(<AgentIcon name="Plandex" icon="not-in-the-catalog" />)
    const unknownTile = tileOf(unknown.container)
    expect(unknownTile.style.backgroundColor).toBe('')
    expect(unknownTile.className).toContain('bg-surface-2')
    expect(unknownTile.textContent).toBe('P')
    unknown.unmount()

    const missing = renderWithProviders(<AgentIcon name="Plandex" />)
    expect(tileOf(missing.container).textContent).toBe('P')
  })

  it('has a brand palette for every icon key declared by a builtin manifest', () => {
    const keys = readdirSync(BUILTIN_CATALOG)
      .filter((file) => file.endsWith('.toml'))
      .map((file) => readFileSync(join(BUILTIN_CATALOG, file), 'utf8').match(/^icon = "(.+)"$/m))
      .map((match) => match?.[1])
      .filter((key): key is string => Boolean(key))

    expect(keys.length).toBeGreaterThan(0)
    expect(keys.filter((key) => !AGENT_BRANDS[key])).toEqual([])
  })
})
