import type { ComponentType } from 'react'
import { BookOpen, IceCreamBowl, SquareTerminal } from 'lucide-react'
import {
  siBun,
  siGo,
  siHomebrew,
  siNpm,
  siPipx,
  siPnpm,
  siPypi,
  siRust,
  siYarn,
} from 'simple-icons'

import type { Manager } from '@/shared/bindings/Manager'

/**
 * The mark of one package manager, drawn on a tile of its own brand colour.
 *
 * `path` is a 24×24 outline drawn in `foreground`. `Glyph` is for a mark that is not a single path:
 * the two managers that have no mark of their own — an install script and a manual step — keep the
 * neutral tile and take a vector icon that says what they are.
 */
export interface ManagerBrand {
  /** Tile background: the manager's own colour. `null` keeps the neutral surface tile. */
  background: string | null
  /** Mark colour, kept legible on `background`. */
  foreground: string | null
  /** Mark size relative to the tile edge. */
  multiple: number
  /** 24×24 mark, drawn in `foreground`. */
  path?: string
  /** Mark that is not a single path. */
  Glyph?: ComponentType<{ size?: number }>
}

/**
 * SOURCE: simple-icons 15.22.0 (https://simpleicons.org, CC0-1.0) for the named marks, with the
 * colour the library pairs with each one. `pip` and `cargo` take the mark of the toolchain they
 * belong to (PyPI, the Rust project) because neither ships a mark of its own, and `winget` is
 * Ahabby's own outline of the official Windows Package Manager icon — a box with a download
 * arrow, the same shape Microsoft's `.github/images/WindowsPackageManager_Assets` draws, in the
 * gold that icon uses (`#bc822a`, sampled from its 256 px PNG).
 *
 * `script` (an official install script, which Ahabby runs through the platform shell) and
 * `manual` (the docs, since there is nothing to run) are not products: they take the neutral
 * tile with a mark that says what they are.
 */
export const MANAGER_BRANDS: Record<Manager, ManagerBrand> = {
  npm: { background: '#cb3837', foreground: '#ffffff', multiple: 0.62, path: siNpm.path },
  pnpm: { background: '#f69220', foreground: '#ffffff', multiple: 0.6, path: siPnpm.path },
  yarn: { background: '#2c8ebb', foreground: '#ffffff', multiple: 0.66, path: siYarn.path },
  bun: { background: '#000000', foreground: '#ffffff', multiple: 0.62, path: siBun.path },
  brew: { background: '#fbb040', foreground: '#ffffff', multiple: 0.7, path: siHomebrew.path },
  winget: {
    background: '#bc822a',
    foreground: '#ffffff',
    multiple: 0.86,
    // The arrow is cut out of the box: its two subpaths wind against the box's own.
    path: 'M4.70 3.30h14.60a1.60 1.60 0 0 1 1.60 1.60v1.30a1.60 1.60 0 0 1 -1.60 1.60h-14.60a1.60 1.60 0 0 1 -1.60 -1.60v-1.30a1.60 1.60 0 0 1 1.60 -1.60zM5.50 9.00h13.00a2.40 2.40 0 0 1 2.40 2.40v6.90a2.40 2.40 0 0 1 -2.40 2.40h-13.00a2.40 2.40 0 0 1 -2.40 -2.40v-6.90a2.40 2.40 0 0 1 2.40 -2.40zM13.25 10.40h-2.50v5.30h2.50zM12.00 20.10 16.30 15.70h-8.60z',
  },
  // SOURCE: the colour is Scoop's own — sampled from the sundae of its official logo
  // (https://github.com/ScoopInstaller/scoopinstaller.github.io, MIT).
  scoop: { background: '#f46da2', foreground: '#ffffff', multiple: 0.66, Glyph: IceCreamBowl },
  pipx: { background: '#2cffaa', foreground: '#000000', multiple: 0.58, path: siPipx.path },
  pip: { background: '#3775a9', foreground: '#ffffff', multiple: 0.56, path: siPypi.path },
  cargo: { background: '#000000', foreground: '#ffffff', multiple: 0.66, path: siRust.path },
  go: { background: '#00add8', foreground: '#ffffff', multiple: 0.72, path: siGo.path },
  script: { background: null, foreground: null, multiple: 0.62, Glyph: SquareTerminal },
  manual: { background: null, foreground: null, multiple: 0.62, Glyph: BookOpen },
}

/** i18n key of a manager's human name, `managers.<id>` in `locales/{en,ru}.json`. */
export const MANAGER_NAME_KEY = {
  npm: 'managers.npm',
  pnpm: 'managers.pnpm',
  yarn: 'managers.yarn',
  bun: 'managers.bun',
  brew: 'managers.brew',
  winget: 'managers.winget',
  scoop: 'managers.scoop',
  pipx: 'managers.pipx',
  pip: 'managers.pip',
  cargo: 'managers.cargo',
  go: 'managers.go',
  script: 'managers.script',
  manual: 'managers.manual',
} as const satisfies Record<Manager, string>
