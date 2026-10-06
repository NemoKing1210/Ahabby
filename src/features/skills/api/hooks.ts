import { useMutation, useQueryClient } from '@tanstack/react-query'

import { ipc } from '@/shared/api/ipc'
import { queryKeys } from '@/shared/api/keys'
import type { Library } from '@/shared/bindings/Library'
import type { ScanReport } from '@/shared/bindings/ScanReport'
import type { Skill } from '@/shared/bindings/Skill'

/** The switch of one skill, flipped. */
function flipped(skill: Skill, skillId: string, enabled: boolean): Skill {
  return skill.id === skillId ? { ...skill, enabled } : skill
}

/** The cached report with one skill's switch already flipped, for the optimistic update. */
function reportWithSkill(report: ScanReport, skillId: string, enabled: boolean): ScanReport {
  const skills = (list: Skill[]) => list.map((skill) => flipped(skill, skillId, enabled))
  return {
    ...report,
    agents: report.agents.map((agent) => ({ ...agent, skills: skills(agent.skills) })),
    shared: { ...report.shared, skills: skills(report.shared.skills) },
  }
}

/**
 * Deletes a skill by moving its directory to the OS trash.
 *
 * `confirm: true` is sent only after the user went through the confirmation dialog; the
 * backend refuses the call otherwise.
 */
export function useDeleteSkill() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (vars: { agentId: string; skillId: string }) =>
      ipc.deleteSkill(vars.agentId, vars.skillId, true),
    onSuccess: (result) => {
      client.setQueryData(queryKeys.agents(), result.report)
      void client.invalidateQueries({ queryKey: queryKeys.library() })
    },
  })
}

/**
 * Switches a skill on or off without deleting it: the backend renames the entry file, so the
 * agent stops loading the skill and the user can switch it back at any time.
 *
 * The answer carries a fresh scan, which the backend takes by asking every agent for its
 * version — so the switch is moved in the cached views first and put back if the write is
 * refused, instead of looking dead for the length of a scan.
 */
export function useSetSkillEnabled() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (vars: { agentId: string; skillId: string; enabled: boolean }) =>
      ipc.setSkillEnabled(vars.agentId, vars.skillId, vars.enabled),
    onMutate: (vars) => {
      const report = client.getQueryData<ScanReport>(queryKeys.agents())
      const library = client.getQueryData<Library>(queryKeys.library())
      if (report) {
        client.setQueryData(queryKeys.agents(), reportWithSkill(report, vars.skillId, vars.enabled))
      }
      if (library) {
        client.setQueryData(queryKeys.library(), {
          ...library,
          skills: library.skills.map((skill) => flipped(skill, vars.skillId, vars.enabled)),
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
