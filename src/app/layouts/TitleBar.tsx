import { Copy, Minus, Square, X } from 'lucide-react'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/shared/lib/cn'
import { Tooltip } from '@/shared/ui/Tooltip'

import { useWindowChrome, useWindowControls } from '../window'

/**
 * The window's header — the caption Ahabby draws itself, where the OS draws none.
 *
 * Only Windows gets one (`WindowChrome.custom`): its DWM caption is the system's own font,
 * buttons and shadow, pinned to at most two colours of the palette, and the app has no system
 * menu to put in it. macOS and Linux keep their frame, so this renders nothing there and the
 * shell starts at the top of the window as it always did.
 *
 * It carries no mark and no product name — the app mark is the tray's and the icon's — and the
 * whole strip is the drag region, exactly as a caption is: a left button drags the window, a
 * second click maximizes it (and is not a drag), and the three buttons on the right are the
 * window's own — the OS's, not the app's — so they are also what the keyboard reaches.
 */

/** One caption button: the glyph the OS draws for that action, on the app's own surface. */
function CaptionButton({
  label,
  onClick,
  danger = false,
  children,
}: {
  label: string
  onClick: () => void
  /** The close button, which is the one a Windows user expects to turn red under the cursor. */
  danger?: boolean
  children: ReactNode
}) {
  return (
    <Tooltip content={label} side="bottom">
      <button
        type="button"
        aria-label={label}
        className={cn(
          'ease-warm flex h-8 w-11 items-center justify-center rounded-md transition-colors duration-150 outline-none',
          'text-muted focus-visible:outline-ring focus-visible:outline-2 focus-visible:outline-offset-2',
          danger ? 'hover:bg-danger hover:text-white' : 'hover:bg-surface-2 hover:text-foreground',
        )}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
  )
}

export function TitleBar() {
  const chrome = useWindowChrome()
  const controls = useWindowControls()
  const { t } = useTranslation()

  if (!chrome?.custom) return null

  const onMouseDown = (event: ReactMouseEvent<HTMLElement>) => {
    // The left button only, and never a third click: the first press of a double click starts a
    // drag that the second one turns into a maximize, which is what a caption does.
    if (event.button !== 0 || event.detail > 2) return
    // The buttons keep their own clicks; only the empty strip around them is a drag region.
    if ((event.target as HTMLElement).closest('button, a, input, [data-no-drag]')) return
    event.preventDefault()
    if (event.detail === 2) controls.toggleMaximize()
    else controls.startDrag()
  }

  return (
    <header
      aria-label={t('window.bar')}
      onMouseDown={onMouseDown}
      className={cn(
        // The bar is the content column's top row, so the shell's own 12px inset is what keeps the
        // buttons off the window edge; there is no padding of its own to add to it.
        'flex h-10 shrink-0 items-center justify-end gap-0.5',
        // An inactive window dims its controls, as the OS does with a caption.
        'ease-warm transition-opacity duration-200',
        chrome.focused ? 'opacity-100' : 'opacity-60',
      )}
    >
      <CaptionButton label={t('window.minimize')} onClick={controls.minimize}>
        <Minus className="size-3.5" strokeWidth={1.5} aria-hidden />
      </CaptionButton>
      <CaptionButton
        label={t(chrome.maximized ? 'window.restore' : 'window.maximize')}
        onClick={controls.toggleMaximize}
      >
        {chrome.maximized ? (
          <Copy className="size-3.5 -scale-x-100" strokeWidth={1.5} aria-hidden />
        ) : (
          <Square className="size-3" strokeWidth={1.5} aria-hidden />
        )}
      </CaptionButton>
      <CaptionButton label={t('window.close')} onClick={controls.close} danger>
        <X className="size-4" strokeWidth={1.5} aria-hidden />
      </CaptionButton>
    </header>
  )
}
