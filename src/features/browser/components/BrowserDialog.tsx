import { ArrowLeft, ArrowRight, Copy, ExternalLink, RotateCw } from 'lucide-react'
import { useMemo, useRef, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { ipc } from '@/shared/api/ipc'
import { copyText } from '@/shared/lib/clipboard'
import { addressUrl, hostOf } from '@/shared/lib/links'
import { Button } from '@/shared/ui/Button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { Input } from '@/shared/ui/Input'
import { toast, toastAppError } from '@/shared/ui/Toast'

import { useWebPage } from '../api/queries'
import { readable } from '../lib/readable'
import {
  BrowserPage,
  BrowserRefusal,
  BrowserSkeleton,
  PageIcon,
  useProxiedImages,
} from './BrowserPage'

/** Shared empty array: a new one on every render would restart the image loading. */
const NO_IMAGES: string[] = []

/**
 * Ahabby's own browser window.
 *
 * It is a modal because the app behind it must not be reachable while a page is being read:
 * the page is third-party content, and every link in it lands in this same window. The toolbar
 * is a real browser's — back, forward, reload, an address the user can type into, copy, and the
 * way out to the operating system's browser — while the body is the backend's answer, sanitized
 * and rendered with Ahabby's own typography.
 */
export function BrowserDialog({
  url,
  onNavigate,
  onBack,
  onForward,
  onClose,
}: {
  url: string
  /** Open another address in this window (a link inside the page, or one typed into the bar). */
  onNavigate: (url: string) => void
  onBack: (() => void) | null
  onForward: (() => void) | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const query = useWebPage(url)
  const page = query.data
  /** Where the reader actually is: a redirect makes the address bar tell the truth. */
  const shown = page?.url ?? url
  const content = useMemo(() => (page ? readable(page.body, page.kind, page.url) : null), [page])

  const articleRef = useRef<HTMLDivElement>(null)
  useProxiedImages(articleRef, content?.images ?? NO_IMAGES)

  const title = content?.title ?? hostOf(shown)
  const openExternal = () => {
    void ipc.openUrl(shown).catch(toastAppError)
  }

  /** A link inside the article that points back into the page itself scrolls, it never navigates. */
  const onAnchorClick = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = event.target instanceof Element ? event.target.closest('[data-anchor]') : null
    if (!anchor) return
    event.preventDefault()
    const id = (anchor.getAttribute('data-anchor') ?? '').slice(1)
    articleRef.current?.querySelector(`[id="${id}"]`)?.scrollIntoView({ block: 'start' })
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        className="h-[min(88vh,900px)] w-[min(1180px,94vw)] max-w-[min(1180px,94vw)]"
        onKeyDown={(event) => {
          // The keys a browser user's fingers already know.
          if (!event.altKey) return
          if (event.key === 'ArrowLeft' && onBack) {
            event.preventDefault()
            onBack()
          }
          if (event.key === 'ArrowRight' && onForward) {
            event.preventDefault()
            onForward()
          }
        }}
      >
        <DialogHeader className="gap-2 pr-16">
          <div className="flex items-center gap-2">
            <PageIcon url={content?.icon ?? null} />
            <DialogTitle className="truncate text-base" title={title}>
              {title}
            </DialogTitle>
          </div>
          <DialogDescription className="truncate font-mono text-[0.75rem]">
            {hostOf(shown)}
          </DialogDescription>
        </DialogHeader>

        <div className="border-border flex shrink-0 items-center gap-2 border-y px-4 py-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('browser.back')}
            disabled={!onBack}
            onClick={() => onBack?.()}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('browser.forward')}
            disabled={!onForward}
            onClick={() => onForward?.()}
          >
            <ArrowRight className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('browser.reload')}
            loading={query.isFetching}
            onClick={() => {
              void query.refetch()
            }}
          >
            <RotateCw className="size-4" />
          </Button>

          <Input
            // Keyed by the address the reader is on: a redirect (or a new page) replaces the
            // field instead of fighting over it, and typing is never overwritten from below.
            key={shown}
            aria-label={t('browser.address')}
            className="h-8 min-w-0 flex-1 font-mono text-[0.75rem]"
            defaultValue={shown}
            spellCheck={false}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              const next = addressUrl(event.currentTarget.value)
              if (!next) {
                // Typing something that is not an address is not an error: the bar goes back to
                // where the reader is, exactly like a browser with no search engine behind it.
                event.currentTarget.value = shown
                return
              }
              if (next === shown) void query.refetch()
              else onNavigate(next)
            }}
            trailing={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('browser.copyAddress')}
                onClick={() => {
                  void copyText(shown).then((ok) => {
                    if (ok) toast.success(t('toast.copied'), shown)
                  })
                }}
              >
                <Copy className="size-3.5" />
              </Button>
            }
          />

          <Button variant="secondary" size="sm" onClick={openExternal}>
            <ExternalLink className="size-3.5" aria-hidden />
            {t('browser.openExternal')}
          </Button>
        </div>

        {query.isFetching ? <div className="ah-reader-progress" aria-hidden /> : null}

        <DialogBody className="px-0 pb-0">
          <div ref={articleRef} className="px-8 py-6" onClick={onAnchorClick}>
            {query.isPending ? (
              <BrowserSkeleton />
            ) : query.isError ? (
              <BrowserRefusal error={query.error} onOpenExternal={openExternal} />
            ) : page && content ? (
              <BrowserPage page={page} content={content} onOpenExternal={openExternal} />
            ) : null}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
