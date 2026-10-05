import type { AgentRef } from '@/shared/bindings/AgentRef'
import { cn } from '@/shared/lib/cn'

import { AgentIcon } from './AgentIcon'

/**
 * Compact pill that names one agent next to its brand tile — the "which agents own this
 * resource" affordance of the library and MCP cards. Deliberately smaller than a `Badge`:
 * the icon carries the identity, so the label can stay quiet.
 */
export function AgentTag({
  agent,
  className,
  title,
}: {
  agent: AgentRef
  className?: string
  /** Tooltip-style hint; when omitted the browser shows nothing on hover. */
  title?: string
}) {
  return (
    <span
      title={title}
      className={cn(
        'border-border bg-surface text-muted inline-flex items-center gap-1.5 rounded-full border py-0.5 pr-2 pl-0.5 text-[0.6875rem] whitespace-nowrap',
        className,
      )}
    >
      <AgentIcon name={agent.name} icon={agent.icon} size="xs" />
      {agent.name}
    </span>
  )
}
