import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { Manager } from '@/shared/bindings/Manager'

import { renderWithProviders } from '@/test/render'

import { ManagerIcon } from './ManagerIcon'
import { MANAGER_BRANDS } from './managerBrands'

const MANIFEST = join(process.cwd(), 'src-tauri/src/domain/manifest.rs')
const LOCALES = join(process.cwd(), 'src/shared/i18n/locales')

/**
 * The variants of the backend's `Manager` enum, camelCased the way `ts-rs` exports them — read
 * from Rust rather than from the generated bindings, so a new manager cannot slip in unnoticed
 * before the bindings are regenerated.
 */
function declaredManagers(): string[] {
  const body = readFileSync(MANIFEST, 'utf8').match(/pub enum Manager \{([\s\S]*?)\n\}/)?.[1] ?? ''
  return (
    body
      .split('\n')
      .map((line) => line.trim().match(/^([A-Z][A-Za-z0-9]*),$/)?.[1])
      .filter((variant): variant is string => Boolean(variant))
      // `Npm` → `npm`, `Winget` → `winget`.
      .map((variant) => variant[0]?.toLowerCase() + variant.slice(1))
  )
}

function tileOf(container: HTMLElement): HTMLElement {
  const tile = container.firstElementChild
  if (!(tile instanceof HTMLElement)) {
    throw new Error('ManagerIcon rendered no tile')
  }
  return tile
}

describe('ManagerIcon', () => {
  it('draws a mark on a tile for every manager the manifest can declare', () => {
    const managers = declaredManagers()
    expect(managers).toContain('npm')

    for (const manager of managers) {
      const { container } = renderWithProviders(<ManagerIcon manager={manager as Manager} />)
      const tile = tileOf(container)

      expect(tile.querySelector('svg'), `${manager} has no mark`).not.toBeNull()
      // A manager is either branded (its own colour) or one of the two that are not products,
      // which keep the neutral surface tile.
      if (MANAGER_BRANDS[manager as Manager].background === null) {
        expect(tile.className, manager).toContain('bg-surface-2')
      } else {
        expect(tile.style.backgroundColor, `${manager} is not painted`).not.toBe('')
      }
    }
  })

  it('names every manager in both locales', () => {
    for (const locale of ['en', 'ru']) {
      const messages = JSON.parse(readFileSync(join(LOCALES, `${locale}.json`), 'utf8')) as {
        managers?: Record<string, string>
      }

      for (const manager of declaredManagers()) {
        expect(messages.managers?.[manager], `${locale}: managers.${manager}`).toBeTruthy()
      }
    }
  })
})
