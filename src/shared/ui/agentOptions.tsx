import { LayoutGrid } from 'lucide-react'

import type { AgentRef } from '@/shared/bindings/AgentRef'
import { ownerName } from '@/shared/lib/owners'

import { AgentIcon, NeutralTile } from './AgentIcon'
import type { SelectOption } from './Select'

/**
 * Rows for the selects that choose an agent.
 *
 * The brand tile is how an agent is recognised everywhere else in the app, so a picker shows it
 * in the closed trigger and in every row; a row that stands for no agent ("all") takes the same
 * tile shape so the logo column is never ragged.
 */
export function agentOption(
  agent: AgentRef,
  { label, description }: { label?: string; description?: string } = {},
): SelectOption {
  return {
    value: agent.id,
    label: label ?? agent.name,
    icon: <AgentIcon name={agent.name} icon={agent.icon} ownerId={agent.id} size="xs" />,
    description,
  }
}

/**
 * An owner: a real agent, or the agent-neutral shared surface whose name is only translatable
 * at the call site (`ownerName`).
 */
export function ownerOption(
  agent: AgentRef,
  sharedLabel: string,
  description?: string,
): SelectOption {
  return agentOption(agent, { label: ownerName(agent, sharedLabel), description })
}

/** The catch-all row of an agent filter; `value` matches what the filters use for "no filter". */
export function anyAgentOption(label: string, description?: string): SelectOption {
  return {
    value: 'all',
    label,
    icon: (
      <NeutralTile>
        <LayoutGrid className="size-3" aria-hidden />
      </NeutralTile>
    ),
    description,
  }
}
