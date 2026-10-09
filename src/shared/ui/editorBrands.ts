import type { ComponentType } from 'react'
import { SquarePen } from 'lucide-react'
import {
  siClion,
  siCursor,
  siGoland,
  siIntellijidea,
  siNotepadplusplus,
  siPhpstorm,
  siPycharm,
  siRider,
  siSublimetext,
  siVscodium,
  siWebstorm,
  siWindsurf,
  siZedindustries,
} from 'simple-icons'

/**
 * The mark of one editor, drawn on a tile of its own brand colour.
 *
 * Same shape as `managerBrands`: `path` is an outline drawn in `foreground` on `background`, and
 * a brand nobody publishes a mark for keeps the neutral tile and takes a vector icon instead.
 * `viewBox` exists because a mark is not always drawn on a 24×24 grid — Visual Studio Code's is
 * a 100×100 one — and `fillRule` because a mark's cut-outs may depend on the even-odd rule.
 */
export interface EditorBrand {
  /** Tile background: the editor's own colour. `null` keeps the neutral surface tile. */
  background: string | null
  /** Mark colour, kept legible on `background`. */
  foreground: string | null
  /** Mark size relative to the tile edge. */
  multiple: number
  /** Mark, drawn in `foreground`. */
  path?: string
  /** Mark that is not a single path. */
  Glyph?: ComponentType<{ size?: number }>
  viewBox?: string
  fillRule?: 'evenodd' | 'nonzero'
}

/**
 * SOURCE: simple-icons 15.22.0 (https://simpleicons.org, CC0-1.0) for the marks it ships, with
 * the colour the library pairs with each one; a light mark (Notepad++) gets a dark one instead,
 * so it stays legible on its own tile.
 *
 * Visual Studio Code left simple-icons, so its mark is the silhouette of the official logo
 * (the ribbon and its cut-out), taken from the brand SVG on Wikimedia Commons —
 * `Visual_Studio_Code_1.35_icon.svg`, whose mask path is the shape below, drawn on the
 * `#007acc` blue the icon uses. Its 100×100 grid is why `viewBox` exists.
 */
export const EDITOR_BRANDS: Record<string, EditorBrand> = {
  vscode: {
    background: '#007acc',
    foreground: '#ffffff',
    multiple: 0.74,
    viewBox: '0 0 100 100',
    fillRule: 'evenodd',
    path: 'M70.9119 99.3171C72.4869 99.9307 74.2828 99.8914 75.8725 99.1264L96.4608 89.2197C98.6242 88.1787 100 85.9892 100 83.5872V16.4133C100 14.0113 98.6243 11.8218 96.4609 10.7808L75.8725 0.873756C73.7862 -0.130129 71.3446 0.11576 69.5135 1.44695C69.252 1.63711 69.0028 1.84943 68.769 2.08341L29.3551 38.0415L12.1872 25.0096C10.589 23.7965 8.35363 23.8959 6.86933 25.2461L1.36303 30.2549C-0.452552 31.9064 -0.454633 34.7627 1.35853 36.417L16.2471 50.0001L1.35853 63.5832C-0.454633 65.2374 -0.452552 68.0938 1.36303 69.7453L6.86933 74.7541C8.35363 76.1043 10.589 76.2037 12.1872 74.9905L29.3551 61.9587L68.769 97.9167C69.3925 98.5406 70.1246 99.0104 70.9119 99.3171ZM75.0152 27.2989L45.1091 50.0001L75.0152 72.7012V27.2989Z',
  },
  cursor: { background: '#000000', foreground: '#ffffff', multiple: 0.6, path: siCursor.path },
  zed: {
    background: '#084ccf',
    foreground: '#ffffff',
    multiple: 0.66,
    path: siZedindustries.path,
  },
  windsurf: {
    background: '#0b100f',
    foreground: '#ffffff',
    multiple: 0.66,
    path: siWindsurf.path,
  },
  vscodium: {
    background: '#2f80ed',
    foreground: '#ffffff',
    multiple: 0.62,
    path: siVscodium.path,
  },
  sublime: {
    background: '#ff9800',
    foreground: '#ffffff',
    multiple: 0.68,
    path: siSublimetext.path,
  },
  notepadpp: {
    background: '#90e59a',
    foreground: '#10240f',
    multiple: 0.7,
    path: siNotepadplusplus.path,
  },
  idea: { background: '#000000', foreground: '#ffffff', multiple: 0.6, path: siIntellijidea.path },
  webstorm: { background: '#000000', foreground: '#ffffff', multiple: 0.6, path: siWebstorm.path },
  pycharm: { background: '#000000', foreground: '#ffffff', multiple: 0.6, path: siPycharm.path },
  phpstorm: { background: '#000000', foreground: '#ffffff', multiple: 0.6, path: siPhpstorm.path },
  goland: { background: '#000000', foreground: '#ffffff', multiple: 0.6, path: siGoland.path },
  clion: { background: '#000000', foreground: '#ffffff', multiple: 0.6, path: siClion.path },
  rider: { background: '#000000', foreground: '#ffffff', multiple: 0.6, path: siRider.path },
}

/**
 * An editor id the table here does not know keeps the neutral tile: it is still offered (the
 * backend named one that exists), just without a brand invented for it.
 */
export const UNKNOWN_EDITOR_BRAND: EditorBrand = {
  background: null,
  foreground: null,
  multiple: 0.62,
  Glyph: SquarePen,
}
