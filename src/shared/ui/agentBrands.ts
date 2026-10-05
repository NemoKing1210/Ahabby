import type { IconType } from '@lobehub/icons/es/types'
import Amp from '@lobehub/icons/es/Amp/components/Mono'
import ClaudeCode from '@lobehub/icons/es/ClaudeCode/components/Mono'
import Cline from '@lobehub/icons/es/Cline/components/Mono'
import Codex from '@lobehub/icons/es/Codex/components/Inner'
import Cursor from '@lobehub/icons/es/Cursor/components/Mono'
import GeminiCli from '@lobehub/icons/es/GeminiCLI/components/Color'
import GithubCopilot from '@lobehub/icons/es/GithubCopilot/components/Mono'
import Goose from '@lobehub/icons/es/Goose/components/Mono'
import HermesAgent from '@lobehub/icons/es/HermesAgent/components/Mono'
import Junie from '@lobehub/icons/es/Junie/components/Mono'
import KiloCode from '@lobehub/icons/es/KiloCode/components/Inner'
import Kiro from '@lobehub/icons/es/Kiro/components/Color'
import OpenClaw from '@lobehub/icons/es/OpenClaw/components/Color'
import OpenCode from '@lobehub/icons/es/OpenCode/components/Mono'
import OpenHands from '@lobehub/icons/es/OpenHands/components/Color'
import Pi from '@lobehub/icons/es/Pi/components/Mono'
import Qwen from '@lobehub/icons/es/Qwen/components/Mono'
import Windsurf from '@lobehub/icons/es/Windsurf/components/Mono'

/**
 * Brand palette for the agents Ahabby manages, keyed by the manifest `icon` value. An avatar
 * tile takes `background`, draws `Logo` (or the initials, when there is no mark) in `foreground`
 * and sizes it by `multiple`. Trademarks belong to their owners and are used only to identify
 * the tool.
 *
 * Keys without an entry fall back to a neutral monogram tile — never a made-up colour.
 */
export interface AgentBrand {
  /** Tile background: the brand's primary colour. */
  background: string
  /** Mark or initials colour, kept legible on `background`. */
  foreground: string
  /** Mark size relative to the tile edge. */
  multiple: number
  /** Brand mark; initials are drawn when the library has none. */
  Logo?: IconType
}

/**
 * SOURCE: @lobehub/icons 5.23.0 `AVATAR_BACKGROUND` / `AVATAR_COLOR` / `AVATAR_ICON_MULTIPLE`
 * and the mark that library pairs with them (https://github.com/lobehub/lobe-icons, MIT).
 *
 * Only leaf components are deep-imported: the package's per-brand index also pulls its `Avatar`
 * wrapper, which drags `@lobehub/ui` and `antd` into the bundle.
 */
const LIBRARY_BRANDS: Record<string, AgentBrand> = {
  claude: { background: '#09090b', foreground: '#d97757', multiple: 0.7, Logo: ClaudeCode },
  codex: { background: '#ffffff', foreground: '#000000', multiple: 0.7, Logo: Codex },
  gemini: { background: '#1e1e2e', foreground: '#ffffff', multiple: 0.7, Logo: GeminiCli },
  amp: { background: '#000000', foreground: '#f34e3f', multiple: 0.6, Logo: Amp },
  kiro: { background: '#9046ff', foreground: '#ffffff', multiple: 1, Logo: Kiro },
  junie: { background: '#000000', foreground: '#47e054', multiple: 0.6, Logo: Junie },
  openhands: { background: '#ffffff', foreground: '#000000', multiple: 0.75, Logo: OpenHands },
  openclaw: { background: '#000000', foreground: '#ffffff', multiple: 0.75, Logo: OpenClaw },
  qwen: { background: '#615ced', foreground: '#ffffff', multiple: 0.75, Logo: Qwen },
  cursor: { background: '#000000', foreground: '#ffffff', multiple: 0.6, Logo: Cursor },
  windsurf: { background: '#ffffff', foreground: '#000000', multiple: 0.75, Logo: Windsurf },
  cline: { background: '#323b43', foreground: '#ffffff', multiple: 0.6, Logo: Cline },
  copilot: { background: '#000000', foreground: '#ffffff', multiple: 0.75, Logo: GithubCopilot },
  goose: { background: '#ffffff', foreground: '#000000', multiple: 0.65, Logo: Goose },
  kilo: { background: '#f8f676', foreground: '#1a1a18', multiple: 0.7, Logo: KiloCode },
  opencode: { background: '#000000', foreground: '#ffffff', multiple: 0.75, Logo: OpenCode },
  pi: { background: '#000000', foreground: '#ffffff', multiple: 0.65, Logo: Pi },
  hermes: { background: '#ffffff', foreground: '#000000', multiple: 0.75, Logo: HermesAgent },
}

type AgentColor = Omit<AgentBrand, 'Logo' | 'multiple'>

/**
 * Agents the icon library does not ship: brand colour plus a contrasting foreground,
 * verified against the source below (checked 2026-10-05). No mark — the tile shows initials.
 */
const AGENT_COLORS: Record<string, AgentColor> = {
  // SOURCE: https://github.com/Aider-AI/aider/blob/main/aider/website/assets/logo.svg
  aider: { background: '#14b014', foreground: '#000000' },
  // SOURCE: AWS Architecture Icons, Arch_Amazon-Q_64.svg tile fill
  amazonq: { background: '#01a88d', foreground: '#000000' },
  // SOURCE: https://www.augmentcode.com/ (`--primary`, `--augment-400`)
  augment: { background: '#1aa049', foreground: '#000000' },
  // SOURCE: https://www.codebuff.com/ (`--acid-matrix`)
  codebuff: { background: '#7cff3f', foreground: '#000000' },
  // SOURCE: https://continue.dev/ stylesheet (accent; the identity itself is monochrome)
  continue: { background: '#1e51f7', foreground: '#ffffff' },
  // SOURCE: https://stuff.charm.sh/crush/charm-crush.png (Charm brand violet)
  crush: { background: '#6b50ff', foreground: '#ffffff' },
  // SOURCE: https://factory.com/ (`--accent-100`)
  droid: { background: '#ef6f2e', foreground: '#000000' },
  // SOURCE: https://forgecode.dev/ (`--ifm-color-brand-orange`)
  forge: { background: '#fb923c', foreground: '#181818' },
  // SOURCE: https://gptme.org/media/icon.svg
  gptme: { background: '#002938', foreground: '#a9bdcd' },
  // SOURCE: https://omp.sh/favicon.svg (site accent)
  omp: { background: '#ed4abf', foreground: '#000000' },
  // SOURCE: https://www.openinterpreter.com/icon.svg
  openinterpreter: { background: '#000000', foreground: '#ffffff' },
  // SOURCE: https://plandex.ai/ (site accent; the logo is a magenta-to-teal gradient)
  plandex: { background: '#ea6df7', foreground: '#000000' },
  // SOURCE: https://github.com/TheR1D/shell_gpt — no brand assets exist; GitHub black
  shellgpt: { background: '#000000', foreground: '#ffffff' },
  // SOURCE: https://www.tabbyml.com (`--burnt-gold`, `--rich-ocre`)
  tabby: { background: '#e68129', foreground: '#472209' },
  // SOURCE: https://github.com/warpdotdev/brand-assets Warp-App-Icon.svg
  warp: { background: '#0868f9', foreground: '#ffffff' },
  // SOURCE: https://zed.dev/brand (Brand Blue)
  zed: { background: '#1348dc', foreground: '#ffffff' },
}

export const AGENT_BRANDS: Record<string, AgentBrand> = {
  ...LIBRARY_BRANDS,
  ...Object.fromEntries(
    Object.entries(AGENT_COLORS).map(([key, color]) => [key, { ...color, multiple: 0.5 }]),
  ),
}
