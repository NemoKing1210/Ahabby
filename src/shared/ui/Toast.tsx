import * as ToastPrimitive from '@radix-ui/react-toast'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { create } from 'zustand'

import { toAppError } from '@/shared/api/errors'
import i18n from '@/shared/i18n'
import { cn } from '@/shared/lib/cn'

import { Button } from './Button'

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
  push: (toast: Omit<ToastItem, 'id'>) => void
  dismiss: (id: number) => void
  remove: (id: number) => void
}

/**
 * Radix unmounts a toast by itself once its exit animation ends; this backstop drops the
 * store entry (and the React root with it) even if that animation never runs.
 */
const TOAST_EXIT_MS = 400

const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) =>
    set((state) => {
      const id = (state.toasts.at(-1)?.id ?? 0) + 1
      // Keep at most three: this is a desktop panel, not a notification centre.
      return { toasts: [...state.toasts.slice(-2), { ...toast, id }] }
    }),
  dismiss: (id) => {
    set((state) => ({
      toasts: state.toasts.map((item) => (item.id === id ? { ...item, closing: true } : item)),
    }))
    window.setTimeout(() => useToastStore.getState().remove(id), TOAST_EXIT_MS)
  },
  remove: (id) => set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) })),
}))

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

  return (
    <ToastPrimitive.Provider duration={6000} swipeDirection="right">
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
      <ToastPrimitive.Viewport className="fixed right-4 bottom-4 z-[60] flex w-[380px] max-w-[92vw] flex-col gap-2 outline-none" />
    </ToastPrimitive.Provider>
  )
}
