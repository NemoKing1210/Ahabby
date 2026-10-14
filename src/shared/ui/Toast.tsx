import * as ToastPrimitive from '@radix-ui/react-toast'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { create } from 'zustand'

import { toAppError } from '@/shared/api/errors'
import type { ToastDuration } from '@/shared/bindings/ToastDuration'
import type { ToastPosition } from '@/shared/bindings/ToastPosition'
import type { ToastSettings } from '@/shared/bindings/ToastSettings'
import i18n from '@/shared/i18n'
import { cn } from '@/shared/lib/cn'

import { Button } from './Button'

/**
 * What the settings document says about the messages, as the Toaster needs it.
 *
 * The Rust side (`services/settings.rs`) owns the ids — `top-left` … `bottom-right`, `short` … —
 * and this module owns what they *mean*: the seconds, the classes and the direction a message
 * enters and leaves by.
 */

/** The default of every knob, mirroring `ToastSettings::default` in Rust. */
export const TOAST_DEFAULTS: ToastSettings = {
  enabled: true,
  position: 'top-center',
  duration: 'normal',
}

/** How long each id keeps a message on screen; `persistent` is closed by the user instead. */
export const TOAST_DURATION_MS: Record<ToastDuration, number> = {
  short: 3000,
  normal: 6000,
  long: 12000,
  persistent: Infinity,
}

/**
 * Where a message is painted, and which way it moves: the two custom properties are read by the
 * enter and swipe-out keyframes (`globals.css`), so one keyframe serves all six positions — a
 * message slides in *from the edge it is anchored to* and is swiped back out the same way.
 */
const VIEWPORT: Record<ToastPosition, string> = {
  'top-left': 'top-4 left-4 [--ah-toast-in-x:-14px] [--ah-toast-swipe-out-x:-100%]',
  'top-center':
    'top-4 left-1/2 -translate-x-1/2 [--ah-toast-in-y:-14px] [--ah-toast-swipe-out-y:-100%]',
  'top-right': 'top-4 right-4 [--ah-toast-in-x:14px] [--ah-toast-swipe-out-x:100%]',
  'bottom-left': 'bottom-4 left-4 [--ah-toast-in-x:-14px] [--ah-toast-swipe-out-x:-100%]',
  'bottom-center':
    'bottom-4 left-1/2 -translate-x-1/2 [--ah-toast-in-y:14px] [--ah-toast-swipe-out-y:100%]',
  'bottom-right': 'bottom-4 right-4 [--ah-toast-in-x:14px] [--ah-toast-swipe-out-x:100%]',
}

/** The way a message is dragged to be thrown away: back towards the edge it came in from. */
const SWIPE: Record<ToastPosition, 'left' | 'right' | 'up' | 'down'> = {
  'top-left': 'left',
  'top-center': 'up',
  'top-right': 'right',
  'bottom-left': 'left',
  'bottom-center': 'down',
  'bottom-right': 'right',
}

type ToastKind = 'info' | 'success' | 'error'

/** One follow-up a toast offers, e.g. "Show diff" after a write. */
export interface ToastAction {
  label: string
  onClick: () => void
}

interface ToastItem {
  id: number
  kind: ToastKind
  title: string
  description?: string
  /** Optional follow-up rendered as a button before the close control. */
  action?: ToastAction
  /** Set while the exit animation plays; the entry is dropped shortly after. */
  closing?: boolean
}

interface ToastState {
  toasts: ToastItem[]
  /** How the messages are painted, from the settings document. */
  config: ToastSettings
  setConfig: (config: ToastSettings) => void
  push: (toast: Omit<ToastItem, 'id'>) => void
  dismiss: (id: number) => void
  remove: (id: number) => void
}

/**
 * Radix unmounts a toast by itself once its exit animation ends; this backstop drops the
 * store entry (and the React root with it) even if that animation never runs.
 */
const TOAST_EXIT_MS = 400

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  config: TOAST_DEFAULTS,
  // Switching the messages off also drops the ones on screen, so switching them back on cannot
  // resurrect what the user already dismissed with that switch.
  setConfig: (config) => set((state) => ({ config, toasts: config.enabled ? state.toasts : [] })),
  push: (toast) => {
    // Off means nothing is shown — not even a failure — so nothing is queued either.
    if (!get().config.enabled) return
    set((state) => {
      const id = (state.toasts.at(-1)?.id ?? 0) + 1
      // Keep at most three: this is a desktop panel, not a notification centre.
      return { toasts: [...state.toasts.slice(-2), { ...toast, id }] }
    })
  },
  dismiss: (id) => {
    set((state) => ({
      toasts: state.toasts.map((item) => (item.id === id ? { ...item, closing: true } : item)),
    }))
    window.setTimeout(() => useToastStore.getState().remove(id), TOAST_EXIT_MS)
  },
  remove: (id) => set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) })),
}))

/**
 * Applies the toast slice of the settings document: at boot, when the Settings page is saved, and
 * from that page's own draft while it is open, so a position and a delay are seen as they are
 * chosen.
 */
export function applyToastSettings(settings: ToastSettings) {
  useToastStore.getState().setConfig(settings)
}

/** Imperative toast API, usable from callbacks that are not React components. */
export const toast = {
  info: (title: string, description?: string, action?: ToastAction) =>
    useToastStore.getState().push({ kind: 'info', title, description, action }),
  success: (title: string, description?: string, action?: ToastAction) =>
    useToastStore.getState().push({ kind: 'success', title, description, action }),
  error: (title: string, description?: string, action?: ToastAction) =>
    useToastStore.getState().push({ kind: 'error', title, description, action }),
}

/**
 * Show a backend error with a translated headline and the backend's own (already human
 * readable) message as the detail line.
 */
export function toastAppError(error: unknown, fallbackKey = 'errors.unknown') {
  const appError = toAppError(error)
  const title = i18n.t(appError.code === 'unknown' ? fallbackKey : `errors.${appError.code}`)
  toast.error(title, appError.message)
}

const ICON: Record<ToastKind, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  error: AlertTriangle,
}

const ACCENT: Record<ToastKind, string> = {
  info: 'text-info-fg',
  success: 'text-success-fg',
  error: 'text-danger-fg',
}

export function Toaster() {
  const toasts = useToastStore((state) => state.toasts)
  const dismiss = useToastStore((state) => state.dismiss)
  const config = useToastStore((state) => state.config)

  // Off paints no viewport at all — a corner nobody can put a message in.
  if (!config.enabled) return null

  return (
    <ToastPrimitive.Provider
      label={i18n.t('settings.notifications')}
      duration={TOAST_DURATION_MS[config.duration]}
      swipeDirection={SWIPE[config.position]}
    >
      {toasts.map((item) => {
        const Icon = ICON[item.kind]
        return (
          <ToastPrimitive.Root
            key={item.id}
            open={!item.closing}
            onOpenChange={(open) => {
              if (!open) dismiss(item.id)
            }}
            className={cn(
              'ah-toast border-border bg-surface shadow-popover flex items-start gap-3 rounded-xl border p-4',
              'data-[state=open]:animate-[ah-toast-in_220ms_var(--ease-warm)_both]',
            )}
          >
            <Icon className={cn('mt-0.5 size-4 shrink-0', ACCENT[item.kind])} aria-hidden />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <ToastPrimitive.Title className="text-foreground text-sm">
                {item.title}
              </ToastPrimitive.Title>
              {item.description ? (
                <ToastPrimitive.Description className="text-muted text-[0.8125rem] break-words">
                  {item.description}
                </ToastPrimitive.Description>
              ) : null}
            </div>
            {item.action ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  item.action?.onClick()
                  dismiss(item.id)
                }}
              >
                {item.action.label}
              </Button>
            ) : null}
            <ToastPrimitive.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label={i18n.t('common.close')}>
                <X className="size-3.5" />
              </Button>
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        )
      })}
      {/* `data-position` is the corner the classes above paint in a form a test can read; the
          classes themselves are what paints it. */}
      <ToastPrimitive.Viewport
        data-position={config.position}
        className={cn(
          'fixed z-[60] flex w-[380px] max-w-[92vw] flex-col gap-2 outline-none',
          VIEWPORT[config.position],
        )}
      />
    </ToastPrimitive.Provider>
  )
}
