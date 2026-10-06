import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, FolderOpen, Info, Pencil, Power, Trash2 } from 'lucide-react'

import { ipc } from '@/shared/api/ipc'
import type { Skill } from '@/shared/bindings/Skill'
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
 * What a right click on a skill card offers: the same actions the card's own controls
 * perform, plus the two path actions the card has no room for. Items only appear when the
 * page wired a handler and the backend would accept the call, so a menu is never a dead end.
 *
 * The trigger is the card itself, so the menu also opens from the keyboard context-menu key
 * while any control inside the card has focus.
 */
export function SkillContextMenu({
  skill,
  onOpen,
  onEdit,
  onDelete,
  onToggle,
  children,
}: {
  skill: Skill
  onOpen?: (skill: Skill) => void
  /** Only offered for a removable skill that has an entry file. */
  onEdit?: (skill: Skill) => void
  /** Only offered for a skill Ahabby is allowed to delete. */
  onDelete?: (skill: Skill) => void
  /** Only offered for a skill Ahabby may switch off; the backend refuses the rest. */
  onToggle?: (skill: Skill, enabled: boolean) => void
  children: ReactNode
}) {
  const { t } = useTranslation()

  const copyPath = () => {
    void copyText(skill.path).then((ok) => {
      if (ok) toast.success(t('toast.copied'), skill.path)
    })
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent aria-label={skill.name}>
        <ContextMenuLabel>{skill.name}</ContextMenuLabel>

        {onOpen ? (
          <ContextMenuItem onSelect={() => onOpen(skill)}>
            <Info aria-hidden />
            {t('common.open')}
          </ContextMenuItem>
        ) : null}

        {onToggle && skill.removable ? (
          <ContextMenuItem onSelect={() => onToggle(skill, !skill.enabled)}>
            <Power aria-hidden />
            {skill.enabled ? t('skills.toggleOff') : t('skills.toggleOn')}
          </ContextMenuItem>
        ) : null}

        {onEdit && skill.entryPath && skill.removable ? (
          <ContextMenuItem onSelect={() => onEdit(skill)}>
            <Pencil aria-hidden />
            {t('configs.edit')}
          </ContextMenuItem>
        ) : null}

        <ContextMenuSeparator />
        <ContextMenuItem onSelect={copyPath}>
          <Copy aria-hidden />
          {t('common.copy')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void ipc.revealPath(skill.path).catch(toastAppError)}>
          <FolderOpen aria-hidden />
          {t('common.reveal')}
        </ContextMenuItem>

        {onDelete && skill.removable ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem destructive onSelect={() => onDelete(skill)}>
              <Trash2 aria-hidden />
              {t('skills.delete')}
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  )
}
