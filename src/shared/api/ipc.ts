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
import type { ExternalEditor } from '@/shared/bindings/ExternalEditor'
import type { ExtensionAction } from '@/shared/bindings/ExtensionAction'
import type { ExtensionRemoval } from '@/shared/bindings/ExtensionRemoval'
import type { ExtensionToggle } from '@/shared/bindings/ExtensionToggle'
import type { HiddenAgent } from '@/shared/bindings/HiddenAgent'
import type { HubEntryDetail } from '@/shared/bindings/HubEntryDetail'
import type { HubInstall } from '@/shared/bindings/HubInstall'
import type { HubInstallRequest } from '@/shared/bindings/HubInstallRequest'
import type { HubPage } from '@/shared/bindings/HubPage'
import type { HubQuery } from '@/shared/bindings/HubQuery'
import type { HubSkillCompare } from '@/shared/bindings/HubSkillCompare'
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
import type { RemoteList } from '@/shared/bindings/RemoteList'
import type { RemovalMode } from '@/shared/bindings/RemovalMode'
import type { SaveResult } from '@/shared/bindings/SaveResult'
import type { ScanReport } from '@/shared/bindings/ScanReport'
import type { Settings } from '@/shared/bindings/Settings'
import type { Skill } from '@/shared/bindings/Skill'
import type { SkillDraft } from '@/shared/bindings/SkillDraft'
import type { SkillRemoval } from '@/shared/bindings/SkillRemoval'
import type { SkillToggle } from '@/shared/bindings/SkillToggle'
import type { SyncAccount } from '@/shared/bindings/SyncAccount'
import type { SyncComparison } from '@/shared/bindings/SyncComparison'
import type { SyncContent } from '@/shared/bindings/SyncContent'
import type { SyncItemList } from '@/shared/bindings/SyncItemList'
import type { SyncItemRef } from '@/shared/bindings/SyncItemRef'
import type { SyncPreview } from '@/shared/bindings/SyncPreview'
import type { SyncProviderId } from '@/shared/bindings/SyncProviderId'
import type { SyncPullTarget } from '@/shared/bindings/SyncPullTarget'
import type { SyncRun } from '@/shared/bindings/SyncRun'
import type { SyncStatus } from '@/shared/bindings/SyncStatus'
import type { TerminalCatalog } from '@/shared/bindings/TerminalCatalog'
import type { TerminalSession } from '@/shared/bindings/TerminalSession'
import type { Theme } from '@/shared/bindings/Theme'
import type { WebImage } from '@/shared/bindings/WebImage'
import type { WebPage } from '@/shared/bindings/WebPage'

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
  /**
   * Hand a URL to the operating system's browser.
   *
   * This is the *escape hatch* of Ahabby's own browser, not a way to open a link: every link in
   * the app goes to the reader first (see `features/browser`), and the user's own browser is
   * what is offered for a page the reader will not show.
   */
  openUrl: (url: string) => invoke<void>('open_url', { url }),

  // --- configs ------------------------------------------------------------------------
  readConfig: (agentId: string, path: string) =>
    invoke<ConfigSnapshot>('read_config', { agentId, path }),
  previewConfigSave: (agentId: string, path: string, content: string, baseSha256: string) =>
    invoke<DiffPreview>('preview_config_save', { agentId, path, content, baseSha256 }),
  saveConfig: (agentId: string, path: string, content: string, baseSha256: string) =>
    invoke<MutationResult<SaveResult>>('save_config', { agentId, path, content, baseSha256 }),
  /**
   * One value edited where it stands: the frontend sends a dotted key and the new text, never a
   * document, and the backend patches the file on disk. `baseSha256` is the hash the row was
   * read at, so a file that changed under the user is refused instead of overwritten.
   */
  previewConfigFact: (
    agentId: string,
    path: string,
    key: string,
    value: string,
    baseSha256: string,
  ) => invoke<DiffPreview>('preview_config_fact', { agentId, path, key, value, baseSha256 }),
  saveConfigFact: (agentId: string, path: string, key: string, value: string, baseSha256: string) =>
    invoke<MutationResult<SaveResult>>('save_config_fact', {
      agentId,
      path,
      key,
      value,
      baseSha256,
    }),
  /** Delete one value from a config file; `confirm` is the dialog the backend also insists on. */
  removeConfigFact: (
    agentId: string,
    path: string,
    key: string,
    baseSha256: string,
    confirm: boolean,
  ) =>
    invoke<MutationResult<SaveResult>>('remove_config_fact', {
      agentId,
      path,
      key,
      baseSha256,
      confirm,
    }),
  listBackups: (agentId: string, path: string) =>
    invoke<BackupEntry[]>('list_backups', { agentId, path }),
  /** The text of one backup, for the comparison view. */
  readBackup: (agentId: string, path: string, backupPath: string) =>
    invoke<string>('read_backup', { agentId, path, backupPath }),
  /** Destructive and irreversible, so Rust insists on an explicit `confirm`. */
  deleteBackup: (agentId: string, path: string, backupPath: string, confirm: boolean) =>
    invoke<BackupEntry[]>('delete_backup', { agentId, path, backupPath, confirm }),
  /** The masked value of a quick-info credential is all the scan exposes; this reads the real one. */
  revealConfigFact: (agentId: string, path: string, key: string) =>
    invoke<string>('reveal_config_fact', { agentId, path, key }),
  restoreBackup: (agentId: string, path: string, backupPath: string) =>
    invoke<MutationResult<SaveResult>>('restore_backup', { agentId, path, backupPath }),
  backupRoot: () => invoke<string>('backup_root'),
  userCatalogDir: () => invoke<string>('user_catalog_dir'),

  // --- editors ------------------------------------------------------------------------
  /** Editors installed on this machine, with the shim each of them was found at. */
  listExternalEditors: () => invoke<ExternalEditor[]>('list_external_editors'),
  openInEditor: (agentId: string, path: string, editorId: string) =>
    invoke<void>('open_in_editor', { agentId, path, editorId }),

  // --- library ------------------------------------------------------------------------
  listLibrary: () => invoke<Library>('list_library'),
  listAgentSkills: (agentId: string) => invoke<Skill[]>('list_agent_skills', { agentId }),
  createSkill: (agentId: string, draft: SkillDraft) =>
    invoke<MutationResult<Skill>>('create_skill', { agentId, draft }),
  deleteSkill: (agentId: string, skillId: string, confirm: boolean) =>
    invoke<MutationResult<SkillRemoval>>('delete_skill', { agentId, skillId, confirm }),
  setSkillEnabled: (agentId: string, skillId: string, enabled: boolean) =>
    invoke<MutationResult<SkillToggle>>('set_skill_enabled', { agentId, skillId, enabled }),

  // --- extensions ---------------------------------------------------------------------
  /** Moves a local extension's files to the OS trash (a package is removed through its CLI). */
  deleteExtension: (agentId: string, extensionId: string, confirm: boolean) =>
    invoke<MutationResult<ExtensionRemoval>>('delete_extension', { agentId, extensionId, confirm }),
  /** Renames a local extension's entry file aside, or back. Nothing is deleted. */
  setExtensionEnabled: (agentId: string, extensionId: string, enabled: boolean) =>
    invoke<MutationResult<ExtensionToggle>>('set_extension_enabled', {
      agentId,
      extensionId,
      enabled,
    }),
  /** The exact command the agent's own CLI would run for one package, resolved by the backend. */
  planExtensionAction: (agentId: string, extensionId: string, action: ExtensionAction) =>
    invoke<InstallPlan>('plan_extension_action', { agentId, extensionId, action }),
  /** Starts that command as a job. Returns the job id; output arrives on `job://output`. */
  runExtensionAction: (
    agentId: string,
    extensionId: string,
    action: ExtensionAction,
    confirm = false,
  ) => invoke<string>('run_extension_action', { agentId, extensionId, action, confirm }),

  // --- hub ----------------------------------------------------------------------------
  /** The collections the hub reads, plus the ones that failed to load. */
  listHubSources: () => invoke<HubSourceCatalog>('list_hub_sources'),
  /** One page of one source. The cursor comes from the previous page's report. */
  searchHub: (sourceId: string, query: HubQuery) =>
    invoke<HubPage>('search_hub', { sourceId, query }),
  /** One entry: its files (a skill) or its launch recipe (an MCP server). */
  getHubEntry: (entryId: string, refresh = false) =>
    invoke<HubEntryDetail>('get_hub_entry', { entryId, refresh }),
  /**
   * Both `SKILL.md` texts for one installed copy of a hub skill: the collection's, and the
   * owner's. The local path is resolved from the scan — never trusted from the webview.
   */
  compareHubSkill: (entryId: string, ownerId: string) =>
    invoke<HubSkillCompare>('compare_hub_skill', { entryId, ownerId }),
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
  /** The shell's tour flag: written when the welcome is skipped or the spotlight finishes. */
  setTourCompleted: (completed: boolean) => invoke<Settings>('set_tour_completed', { completed }),
  setWindowTheme: (theme: Theme, dark: boolean, caption: string, text: string) =>
    invoke<void>('set_window_theme', { theme, dark, caption, text }),

  // --- cloud sync ---------------------------------------------------------------------
  /** The connection, the last runs and the last error. */
  syncStatus: () => invoke<SyncStatus>('get_sync_status'),
  /** Check the stored token against the provider; answers who the account is. */
  verifySyncConnection: () => invoke<SyncAccount>('verify_sync_connection'),
  /** Store the token in its own file, or clear it with an empty string. Never read back. */
  setSyncToken: (provider: SyncProviderId, token: string) =>
    invoke<SyncStatus>('set_sync_token', { provider, token }),
  /** Every item of this machine that cloud sync knows about, with what is already uploaded. */
  listSyncItems: (ownerId: string | null = null) =>
    invoke<SyncItemList>('list_sync_items', { ownerId }),
  /** The copies the connected account holds. `refresh` bypasses the backend's minute of cache. */
  listRemoteSyncItems: (refresh = false) =>
    invoke<RemoteList>('list_remote_sync_items', { refresh }),
  /** What restoring one copy would do — nothing is written. */
  previewSyncPull: (remoteId: string, ownerId: string) =>
    invoke<SyncPreview>('preview_sync_pull', { remoteId, ownerId }),
  /** One item of this machine, as a reader shows it: text, sizes, binary by its size alone. */
  readSyncItem: (ownerId: string, itemId: string) =>
    invoke<SyncContent>('read_sync_item', { ownerId, itemId }),
  /** One cloud copy, as a reader shows it. */
  readRemoteSyncItem: (remoteId: string) =>
    invoke<SyncContent>('read_remote_sync_item', { remoteId }),
  /** One item against its cloud copy, file by file, with both texts for a diff. */
  compareSyncItem: (remoteId: string, ownerId: string) =>
    invoke<SyncComparison>('compare_sync_item', { remoteId, ownerId }),
  /** Upload the selected items. */
  pushSyncItems: (items: SyncItemRef[]) =>
    invoke<MutationResult<SyncRun>>('push_sync_items', { items }),
  /** Upload everything automatic saving covers — the "save everything now" action. */
  pushAllSyncItems: () => invoke<MutationResult<SyncRun>>('push_all_sync_items'),
  /** Restore the selected copies; the backend refuses a call without `confirm`. */
  pullSyncItems: (targets: SyncPullTarget[], confirm: boolean) =>
    invoke<MutationResult<SyncRun>>('pull_sync_items', { targets, confirm }),
  /** Remove one cloud copy; the local files are left alone. */
  deleteRemoteSyncItem: (remoteId: string, confirm: boolean) =>
    invoke<SyncRun>('delete_remote_sync_item', { remoteId, confirm }),

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

  // --- browser ------------------------------------------------------------------------
  /**
   * Read one page for Ahabby's own browser.
   *
   * The window never loads a remote origin, so a link cannot navigate the app away and a
   * third-party page never runs next to the IPC bridge; a document the reader cannot show
   * (a PDF, an image, a scheme no desktop app honours) comes back as `not_supported` and the
   * dialog offers the user's own browser instead.
   */
  fetchWebPage: (url: string) => invoke<WebPage>('fetch_web_page', { url }),
  /** One image of a page, base64, which the reader turns into a `data:` URL. */
  fetchWebImage: (url: string) => invoke<WebImage>('fetch_web_image', { url }),
}
