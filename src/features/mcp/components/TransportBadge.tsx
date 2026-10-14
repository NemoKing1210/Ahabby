import type { McpServer } from '@/shared/bindings/McpServer'
import { Badge } from '@/shared/ui/Badge'

/**
 * How a server is spoken to. Worn by the card and by the detail dialog it opens, so one
 * transport keeps one colour wherever it is shown.
 */
export function TransportBadge({ server }: { server: McpServer }) {
  const tone =
    server.transport.type === 'http'
      ? 'info'
      : server.transport.type === 'stdio'
        ? 'accent'
        : 'neutral'
  return <Badge tone={tone}>{server.transport.type}</Badge>
}
