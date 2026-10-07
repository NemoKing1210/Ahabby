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
import type { HubEntryDetail } from '@/shared/bindings/HubEntryDetail'
import type { HubInstall } from '@/shared/bindings/HubInstall'
import type { HubInstallRequest } from '@/shared/bindings/HubInstallRequest'
import type { HubPage } from '@/shared/bindings/HubPage'
import type { HubQuery } from '@/shared/bindings/HubQuery'
import type { HubSourceCatalog } from '@/shared/bindings/HubSourceCatalog'
import type { InstallAction } from '@/shared/bindings/InstallAction'
import type { InstallPlan } from '@/shared/bindings/InstallPlan'
import type { Library } from '@/shared/bindings/Library'
import type { McpRemoval } from '@/shared/bindings/McpRemoval'
import type { McpServer } from '@/shared/bindings/McpServer'
import type { McpServerDraft } from '@/shared/bindings/McpServerDraft'
import type { McpToggle } from '@/shared/bindings/McpToggle'
import type { MutationResult } from '@/shared/bindings/MutationResult'
import type { PackageManagerInfo } from '@/shared/bindings/PackageManagerInfo'
import type { ProjectFolder } from '@/shared/bindings/ProjectFolder'
import type { RemovalMode } from '@/shared/bindings/RemovalMode'
import type { SaveResult } from '@/shared/bindings/SaveResult'
import type { ScanReport } from '@/shared/bindings/ScanReport'
import type { Settings } from '@/shared/bindings/Settings'
import type { Skill } from '@/shared/bindings/Skill'
import type { SkillDraft } from '@/shared/bindings/SkillDraft'
import type { SkillRemoval } from '@/shared/bindings/SkillRemoval'
import type { SkillToggle } from '@/shared/bindings/SkillToggle'
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
  /** The masked value of a quick-info credential is all the scan exposes; this reads the real one. */
  revealConfigFact: (agentId: string, path: string, key: string) =>
    invoke<string>('reveal_config_fact', { agentId, path, key }),
  restoreBackup: (agentId: string, path: string, backupPath: string) =>
    invoke<MutationResult<SaveResult>>('restore_backup', { agentId, path, backupPath }),
  backupRoot: () => invoke<string>('backup_root'),
  userCatalogDir: () => invoke<string>('user_catalog_dir'),

  // --- library ------------------------------------------------------------------------
  listLibrary: () => invoke<Library>('list_library'),
  listAgentSkills: (agentId: string) => invoke<Skill[]>('list_agent_skills', { agentId }),
  createSkill: (agentId: string, draft: SkillDraft) =>
    invoke<MutationResult<Skill>>('create_skill', { agentId, draft }),
  deleteSkill: (agentId: string, skillId: string, confirm: boolean) =>
    invoke<MutationResult<SkillRemoval>>('delete_skill', { agentId, skillId, confirm }),
  setSkillEnabled: (agentId: string, skillId: string, enabled: boolean) =>
    invoke<MutationResult<SkillToggle>>('set_skill_enabled', { agentId, skillId, enabled }),

  // --- hub ----------------------------------------------------------------------------
  /** The collections the hub reads, plus the ones that failed to load. */
  listHubSources: () => invoke<HubSourceCatalog>('list_hub_sources'),
  /** One page of one source. The cursor comes from the previous page's report. */
  searchHub: (sourceId: string, query: HubQuery) =>
    invoke<HubPage>('search_hub', { sourceId, query }),
  /** One entry: its files (a skill) or its launch recipe (an MCP server). */
  getHubEntry: (entryId: string, refresh = false) =>
    invoke<HubEntryDetail>('get_hub_entry', { entryId, refresh }),
  /** Install one entry for an owner the scan knows (`shared`, an agent, or `project:<hash>`). */
  installHubResource: (request: HubInstallRequest) =>
    invoke<MutationResult<HubInstall>>('install_hub_resource', { request }),

  // --- projects -----------------------------------------------------------------------
  /** Adds a folder to the Projects screen and rescans it; nothing on disk is touched. */
  addProjectFolder: (path: string) =>
    invoke<MutationResult<ProjectFolder>>('add_project_folder', { path }),
  /** Forgets the folder. The directory itself is left alone. */
  removeProjectFolder: (folderId: string) =>
    invoke<MutationResult<ProjectFolder>>('remove_project_folder', { folderId }),
  /**
   * The OS's own folder picker, opened by the backend: it answers with the path the user chose,
   * or `null` when the dialog was cancelled. Nothing is read, added or written by this call.
   */
  pickProjectFolder: () => invoke<string | null>('pick_project_folder'),

  // --- mcp ----------------------------------------------------------------------------
  listAgentMcpServers: (agentId: string) =>
    invoke<McpServer[]>('list_agent_mcp_servers', { agentId }),
  createMcpServer: (agentId: string, draft: McpServerDraft) =>
    invoke<MutationResult<McpServer>>('create_mcp_server', { agentId, draft }),
  deleteMcpServer: (agentId: string, serverId: string, confirm: boolean) =>
    invoke<MutationResult<McpRemoval>>('delete_mcp_server', { agentId, serverId, confirm }),
  setMcpServerEnabled: (agentId: string, serverId: string, enabled: boolean) =>
    invoke<MutationResult<McpToggle>>('set_mcp_server_enabled', { agentId, serverId, enabled }),
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
  /** The shell's own state: written by the sidebar and by navigation, never by the Settings page. */
  setSidebarCollapsed: (collapsed: boolean) =>
    invoke<Settings>('set_sidebar_collapsed', { collapsed }),
  setLastRoute: (route: string | null) => invoke<Settings>('set_last_route', { route }),
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
