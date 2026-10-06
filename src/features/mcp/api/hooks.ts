import { useMutation, useQueryClient } from '@tanstack/react-query'

import { ipc } from '@/shared/api/ipc'
import { queryKeys } from '@/shared/api/keys'
import type { Library } from '@/shared/bindings/Library'
import type { McpServer } from '@/shared/bindings/McpServer'
import type { McpServerDraft } from '@/shared/bindings/McpServerDraft'
import type { ScanReport } from '@/shared/bindings/ScanReport'

/** The switch of one server, flipped. */
function flipped(server: McpServer, serverId: string, enabled: boolean): McpServer {
  return server.id === serverId ? { ...server, enabled } : server
}

/** The cached report with one server's switch already flipped, for the optimistic update. */
function reportWithServer(report: ScanReport, serverId: string, enabled: boolean): ScanReport {
  const servers = (list: McpServer[]) => list.map((server) => flipped(server, serverId, enabled))
  return {
    ...report,
    agents: report.agents.map((agent) => ({
      ...agent,
      mcpServers: servers(agent.mcpServers),
    })),
    shared: { ...report.shared, mcpServers: servers(report.shared.mcpServers) },
  }
}

/**
 * Adds a server to the MCP config file of the owner — a scanned agent or the shared surface.
 *
 * The entry is written in the standard shape (`command`/`args`/`env` or `type: http` with
 * `url`/`headers`), so it is a normal, switchable server on the next scan.
 */
export function useCreateMcpServer() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (vars: { agentId: string; draft: McpServerDraft }) =>
      ipc.createMcpServer(vars.agentId, vars.draft),
    onSuccess: (result) => {
      client.setQueryData(queryKeys.agents(), result.report)
      void client.invalidateQueries({ queryKey: queryKeys.library() })
    },
  })
}

export function useDeleteMcpServer() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (vars: { agentId: string; serverId: string }) =>
      ipc.deleteMcpServer(vars.agentId, vars.serverId, true),
    onSuccess: (result) => {
      client.setQueryData(queryKeys.agents(), result.report)
      void client.invalidateQueries({ queryKey: queryKeys.library() })
    },
  })
}

/**
 * Switches an MCP server on or off by moving its entry inside the same config file: nothing is
 * deleted and the move is reversible from the UI.
 *
 * The answer carries a fresh scan, which the backend takes by asking every agent for its
 * version — so the switch is moved in the cached views first and put back if the write is
 * refused, instead of looking dead for the length of a scan.
 */
export function useSetMcpServerEnabled() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (vars: { agentId: string; serverId: string; enabled: boolean }) =>
      ipc.setMcpServerEnabled(vars.agentId, vars.serverId, vars.enabled),
    onMutate: (vars) => {
      const report = client.getQueryData<ScanReport>(queryKeys.agents())
      const library = client.getQueryData<Library>(queryKeys.library())
      if (report) {
        client.setQueryData(
          queryKeys.agents(),
          reportWithServer(report, vars.serverId, vars.enabled),
        )
      }
      if (library) {
        client.setQueryData(queryKeys.library(), {
          ...library,
          mcpServers: library.mcpServers.map((server) =>
            flipped(server, vars.serverId, vars.enabled),
          ),
        })
      }
      return { report, library }
    },
    onError: (_error, _vars, context) => {
      if (context?.report) client.setQueryData(queryKeys.agents(), context.report)
      if (context?.library) client.setQueryData(queryKeys.library(), context.library)
    },
    onSuccess: (result) => {
      client.setQueryData(queryKeys.agents(), result.report)
      void client.invalidateQueries({ queryKey: queryKeys.library() })
    },
  })
}

/**
 * Reads exactly one secret value the user asked to see. Values are masked by the backend on
 * purpose, so this is the only path that can bring a token into the webview.
 */
export function useRevealSecret() {
  return useMutation({
    mutationFn: (vars: { agentId: string; serverId: string; key: string }) =>
      ipc.revealMcpSecret(vars.agentId, vars.serverId, vars.key),
  })
}
