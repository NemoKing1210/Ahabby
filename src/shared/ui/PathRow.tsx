import { Copy, FolderOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ipc } from '@/shared/api/ipc'
import { copyText } from '@/shared/lib/clipboard'
import { shortenPath } from '@/shared/lib/format'
import { cn } from '@/shared/lib/cn'

import { Button } from './Button'
import { toast, toastAppError } from './Toast'
import { Tooltip } from './Tooltip'

/** Path with the two actions that are used on almost every screen. */
export function PathRow({
  path,
  revealable = true,
  className,
  children,
}: {
  path: string
  revealable?: boolean
  className?: string
  children?: React.ReactNode
}) {
  const { t } = useTranslation()

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Tooltip content={path}>
        <code className="bg-surface-2 text-muted min-w-0 flex-1 truncate rounded-md px-2 py-1 font-mono text-[0.75rem]">
          {shortenPath(path, 5)}
        </code>
      </Tooltip>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('common.copy')}
        onClick={() => {
          void copyText(path).then((ok) => {
            if (ok) toast.success(t('toast.copied'), path)
          })
        }}
      >
        <Copy className="size-3.5" />
      </Button>
      {revealable ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('common.reveal')}
          onClick={() => {
            void ipc.revealPath(path).catch(toastAppError)
          }}
        >
          <FolderOpen className="size-3.5" />
        </Button>
      ) : null}
      {children}
    </div>
  )
}
