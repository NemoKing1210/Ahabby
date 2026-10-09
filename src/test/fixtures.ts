import type { ScanReport } from '@/shared/bindings/ScanReport'
import type { Settings } from '@/shared/bindings/Settings'
import type { SyncSettings } from '@/shared/bindings/SyncSettings'

/**
 * A scan report of a machine that holds nothing — the base every test that needs a report
 * spreads its own agents into.
 */
export const emptyScanReport: ScanReport = {
  agents: [],
  problems: [],
  scannedAtMs: 0,
  durationMs: 0,
  installed: 0,
  availableToInstall: 0,
  os: 'windows',
  shared: { configs: [], skills: [], mcpServers: [], other: [], roots: [] },
  projects: { folders: [], projects: [], scannedAtMs: 0, durationMs: 0 },
}

/**
 * The default cloud sync configuration, as the backend would send it.
 *
 * Every test that builds a `Settings` needs it: the document is one whole value, so a fixture
 * that omits `sync` is not a `Settings` at all. Kept here rather than copied into each factory,
 * so the next field the backend adds is one edit and not seven.
 */
export const emptySyncSettings: SyncSettings = {
  enabled: false,
  provider: 'gist',
  mode: 'manual',
  autoIntervalMinutes: 30,
  autoKinds: ['config', 'env', 'skill', 'mcp'],
  autoOwners: [],
  autoOnScan: true,
  includeSecrets: false,
  excludePatterns: [],
  maxFileBytes: 512 * 1024,
}

/** A whole settings document with the given overrides — what a test renders the app with. */
export function testSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    language: 'en',
    theme: 'system',
    accent: 'clay',
    accentCustom: null,
    interfaceScale: 100,
    textScale: 100,
    fontFamily: 'inter',
    monoFont: 'jetbrains',
    extraScanPaths: [],
    networkVersionChecks: true,
    backupDir: null,
    versionCacheMinutes: 60,
    proxyMode: 'none',
    proxyUrl: null,
    hiddenAgents: [],
    favoriteAgents: [],
    terminal: 'builtin',
    terminalTheme: 'auto',
    projectFolders: [],
    launchAtLogin: false,
    trayIcon: true,
    closeToTray: true,
    startMinimized: false,
    sidebarCollapsed: false,
    lastRoute: null,
    tourCompleted: true,
    sync: emptySyncSettings,
    ...overrides,
  }
}
