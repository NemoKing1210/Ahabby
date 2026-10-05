/**
 * The single place that talks to the backend.
 *
 * Components and hooks never call `invoke` directly — they go through these typed wrappers,
 * whose types are generated from the Rust structs by `ts-rs` (`npm run bindings`). Renaming
 * a backend command or field therefore breaks the build instead of the app at runtime.
 */

import { invoke } from '@tauri-apps/api/core'

import type { Agent } from '@/shared/bindings/Agent'
import type { AgentRemoval } from '@/shared/bindings/AgentRemoval'
import type { BackupEntry } from '@/shared/bindings/BackupEntry'
import type { ConfigSnapshot } from '@/shared/bindings/ConfigSnapshot'
import type { DiffPreview } from '@/shared/bindings/DiffPreview'
import type { HiddenAgent } from '@/shared/bindings/HiddenAgent'
import type { InstallAction } from '@/shared/bindings/InstallAction'
import type { InstallPlan } from '@/shared/bindings/InstallPlan'
import type { Library } from '@/shared/bindings/Library'
import type { McpRemoval } from '@/shared/bindings/McpRemoval'
import type { McpServer } from '@/shared/bindings/McpServer'
import type { MutationResult } from '@/shared/bindings/MutationResult'
import type { PackageManagerInfo } from '@/shared/bindings/PackageManagerInfo'
import type { RemovalMode } from '@/shared/bindings/RemovalMode'
import type { SaveResult } from '@/shared/bindings/SaveResult'
import type { ScanReport } from '@/shared/bindings/ScanReport'
import type { Settings } from '@/shared/bindings/Settings'
import type { Skill } from '@/shared/bindings/Skill'
import type { SkillRemoval } from '@/shared/bindings/SkillRemoval'
import type { TerminalCatalog } from '@/shared/bindings/TerminalCatalog'
import type { TerminalSession } from '@/shared/bindings/TerminalSession'
import type { Theme } from '@/shared/bindings/Theme'

export const ipc = {
  // --- agents -------------------------------------------------------------------------
  listAgents: (force = false) => invoke<ScanReport>('list_agents', { force }),
  /** The previous run's report, without scanning — `null` when nothing has been scanned yet. */
  cachedAgents: () => invoke<ScanReport | null>('cached_agents'),
  rescan: () => invoke<ScanReport>('rescan'),
  getAgent: (agentId: string) => invoke<Agent>('get_agent', { agentId }),
  removeAgent: (agentId: string, mode: RemovalMode, confirm: boolean) =>
    invoke<MutationResult<AgentRemoval>>('remove_agent', { agentId, mode, confirm }),
  restoreAgent: (agentId: string) =>
    invoke<MutationResult<HiddenAgent>>('restore_agent', { agentId }),
  listPackageManagers: () => invoke<PackageManagerInfo[]>('list_package_managers'),
  revealPath: (path: string) => invoke<void>('reveal_path', { path }),
  openUrl: (url: string) => invoke<void>('open_url', { url }),

  // --- configs ------------------------------------------------------------------------
  readConfig: (agentId: string, path: string) =>
    invoke<ConfigSnapshot>('read_config', { agentId, path }),
  previewConfigSave: (agentId: string, path: string, content: string, baseSha256: string) =>
    invoke<DiffPreview>('preview_config_save', { agentId, path, content, baseSha256 }),
  saveConfig: (agentId: string, path: string, content: string, baseSha256: string) =>
    invoke<MutationResult<SaveResult>>('save_config', { agentId, path, content, baseSha256 }),
  listBackups: (agentId: string, path: string) =>
    invoke<BackupEntry[]>('list_backups', { agentId, path }),
  restoreBackup: (agentId: string, path: string, backupPath: string) =>
    invoke<MutationResult<SaveResult>>('restore_backup', { agentId, path, backupPath }),
  backupRoot: () => invoke<string>('backup_root'),
  userCatalogDir: () => invoke<string>('user_catalog_dir'),

  // --- library ------------------------------------------------------------------------
  listLibrary: () => invoke<Library>('list_library'),
  listAgentSkills: (agentId: string) => invoke<Skill[]>('list_agent_skills', { agentId }),
  deleteSkill: (agentId: string, skillId: string, confirm: boolean) =>
    invoke<MutationResult<SkillRemoval>>('delete_skill', { agentId, skillId, confirm }),

  // --- mcp ----------------------------------------------------------------------------
  listAgentMcpServers: (agentId: string) =>
    invoke<McpServer[]>('list_agent_mcp_servers', { agentId }),
  deleteMcpServer: (agentId: string, serverId: string, confirm: boolean) =>
    invoke<MutationResult<McpRemoval>>('delete_mcp_server', { agentId, serverId, confirm }),
  revealMcpSecret: (agentId: string, serverId: string, key: string) =>
    invoke<string>('reveal_mcp_secret', { agentId, serverId, key }),

  // --- install / update ---------------------------------------------------------------
  planInstall: (agentId: string, action: InstallAction, methodId?: string | null) =>
    invoke<InstallPlan>('plan_install', { agentId, action, methodId: methodId ?? null }),
  runInstall: (agentId: string, action: InstallAction, methodId?: string | null, confirm = false) =>
    invoke<string>('run_install', { agentId, action, methodId: methodId ?? null, confirm }),
  cancelJob: (jobId: string) => invoke<boolean>('cancel_job', { jobId }),
  runningJobs: () => invoke<string[]>('running_jobs'),
  rescanAfterJob: () => invoke<ScanReport>('rescan_after_job'),

  // --- settings -----------------------------------------------------------------------
  getSettings: () => invoke<Settings>('get_settings'),
  setAgentFavorite: (agentId: string, favorite: boolean) =>
    invoke<Settings>('set_agent_favorite', { agentId, favorite }),
  saveSettings: (settings: Settings) => invoke<Settings>('save_settings', { settings }),
  setWindowTheme: (theme: Theme, dark: boolean, caption: string, text: string) =>
    invoke<void>('set_window_theme', { theme, dark, caption, text }),

  // --- terminals ----------------------------------------------------------------------
  /** Built-in terminal first, then every terminal installed on this machine. */
  listTerminals: () => invoke<TerminalCatalog>('list_terminals'),
  /** Start an agent in Ahabby's own terminal; output arrives on `terminal://output`. */
  launchTerminal: (agentId: string, cwd: string | null, cols: number, rows: number) =>
    invoke<TerminalSession>('launch_terminal', { agentId, cwd, cols, rows }),
  writeTerminal: (sessionId: string, data: string) =>
    invoke<void>('write_terminal', { sessionId, data }),
  resizeTerminal: (sessionId: string, cols: number, rows: number) =>
    invoke<void>('resize_terminal', { sessionId, cols, rows }),
  closeTerminal: (sessionId: string) => invoke<boolean>('close_terminal', { sessionId }),
  listTerminalSessions: () => invoke<TerminalSession[]>('list_terminal_sessions'),
  /** Start an agent in a terminal installed on this machine. */
  openInTerminal: (agentId: string, terminalId: string, cwd: string | null) =>
    invoke<void>('open_in_terminal', { agentId, terminalId, cwd }),
}
