import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, FileCode2, FolderOpen, Power, Trash2 } from 'lucide-react'

import { ipc } from '@/shared/api/ipc'
import type { McpServer } from '@/shared/bindings/McpServer'
import { copyText } from '@/shared/lib/clipboard'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/shared/ui/ContextMenu'
import { toast, toastAppError } from '@/shared/ui/Toast'

import type { EditorDocument } from '@/features/editor/model'

/**
 * What a right click on an MCP server card offers: the actions its own controls perform,
 * plus the two path actions the card's layout has no room for. Items only appear when the
 * page wired a handler and the server is removable, so the menu never shows a dead end.
 *
 * The trigger is the card itself, so the menu also opens from the keyboard context-menu key
 * while any control inside the card has focus.
 */
export function McpContextMenu({
  server,
  sourceDocument,
  onOpen,
  onDelete,
  onToggle,
  children,
}: {
  server: McpServer
  /** The config file the entry lives in, when the scan found one Ahabby may address. */
  sourceDocument?: EditorDocument | null
  onOpen?: (document: EditorDocument) => void
  onDelete?: (server: McpServer) => void
  /** Only offered for a server Ahabby may switch off; the backend refuses the rest. */
  onToggle?: (server: McpServer, enabled: boolean) => void
  children: ReactNode
}) {
  const { t } = useTranslation()

  const copyPath = () => {
    void copyText(server.sourceConfig).then((ok) => {
      if (ok) toast.success(t('toast.copied'), server.sourceConfig)
    })
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent aria-label={server.name}>
        <ContextMenuLabel>{server.name}</ContextMenuLabel>

        {sourceDocument && onOpen ? (
          <ContextMenuItem onSelect={() => onOpen(sourceDocument)}>
            <FileCode2 aria-hidden />
            {sourceDocument.editable ? t('mcp.editConfig') : t('configs.view')}
          </ContextMenuItem>
        ) : null}

        {onToggle && server.removable ? (
          <ContextMenuItem onSelect={() => onToggle(server, !server.enabled)}>
            <Power aria-hidden />
            {server.enabled ? t('mcp.toggleOff') : t('mcp.toggleOn')}
          </ContextMenuItem>
        ) : null}

        <ContextMenuSeparator />
        <ContextMenuItem onSelect={copyPath}>
          <Copy aria-hidden />
          {t('common.copy')}
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => void ipc.revealPath(server.sourceConfig).catch(toastAppError)}
        >
          <FolderOpen aria-hidden />
          {t('common.reveal')}
        </ContextMenuItem>

        {onDelete && server.removable ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem destructive onSelect={() => onDelete(server)}>
              <Trash2 aria-hidden />
              {t('mcp.delete')}
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  )
}
