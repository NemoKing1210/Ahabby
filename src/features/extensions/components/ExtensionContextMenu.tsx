import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, FolderOpen, Info, Pencil, Power, RefreshCw, Trash2 } from 'lucide-react'

import { ipc } from '@/shared/api/ipc'
import type { Extension } from '@/shared/bindings/Extension'
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

/**
 * What a right click on an extension card offers: the same actions as the card's own controls,
 * plus the two path actions the card has no room for.
 *
 * Items only appear when the page wired a handler and the backend would accept the call, so the
 * menu is never a dead end — and the trigger is the card itself, so it also opens from the
 * keyboard context-menu key.
 */
export function ExtensionContextMenu({
  extension,
  onInfo,
  onUpdate,
  onEdit,
  onRemove,
  onToggle,
  children,
}: {
  extension: Extension
  onInfo?: (extension: Extension) => void
  /** Only offered for a package the agent's CLI can reconcile. */
  onUpdate?: (extension: Extension) => void
  /** Only offered for a local extension with an entry file. */
  onEdit?: (extension: Extension) => void
  /** Only offered for an extension Ahabby is allowed to remove. */
  onRemove?: (extension: Extension) => void
  /** Only offered for a local extension Ahabby may switch off; the backend refuses the rest. */
  onToggle?: (extension: Extension, enabled: boolean) => void
  children: ReactNode
}) {
  const { t } = useTranslation()
  const target = extension.path ?? extension.source

  const copyPath = () => {
    void copyText(target).then((ok) => {
      if (ok) toast.success(t('toast.copied'), target)
    })
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent aria-label={extension.name}>
        <ContextMenuLabel>{extension.name}</ContextMenuLabel>

        {onInfo ? (
          <ContextMenuItem onSelect={() => onInfo(extension)}>
            <Info aria-hidden />
            {t('extensions.details')}
          </ContextMenuItem>
        ) : null}

        {onUpdate && extension.canUpdate ? (
          <ContextMenuItem onSelect={() => onUpdate(extension)}>
            <RefreshCw aria-hidden />
            {t('extensions.update')}
          </ContextMenuItem>
        ) : null}

        {onToggle && extension.canToggle ? (
          <ContextMenuItem onSelect={() => onToggle(extension, !extension.enabled)}>
            <Power aria-hidden />
            {extension.enabled ? t('extensions.toggleOff') : t('extensions.toggleOn')}
          </ContextMenuItem>
        ) : null}

        {onEdit && extension.entryPath ? (
          <ContextMenuItem onSelect={() => onEdit(extension)}>
            <Pencil aria-hidden />
            {t('configs.edit')}
          </ContextMenuItem>
        ) : null}

        <ContextMenuSeparator />
        <ContextMenuItem onSelect={copyPath}>
          <Copy aria-hidden />
          {t('common.copy')}
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            if (extension.path) void ipc.revealPath(extension.path).catch(toastAppError)
          }}
          disabled={!extension.path}
        >
          <FolderOpen aria-hidden />
          {t('common.reveal')}
        </ContextMenuItem>

        {onRemove && extension.canRemove ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem destructive onSelect={() => onRemove(extension)}>
              <Trash2 aria-hidden />
              {t('extensions.remove')}
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  )
}
