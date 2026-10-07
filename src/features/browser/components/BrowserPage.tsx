import { AlertTriangle, CircleAlert, ExternalLink, FileQuestion, Globe } from 'lucide-react'
import { useEffect, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'

import { toAppError } from '@/shared/api/errors'
import type { WebPage } from '@/shared/bindings/WebPage'
import { Button } from '@/shared/ui/Button'
import { EmptyState, ErrorState } from '@/shared/ui/EmptyState'
import { Skeleton } from '@/shared/ui/Primitives'

import { proxiedImage } from '../lib/images'
import type { Readable, ReadableLink } from '../lib/readable'

/**
 * The page the reader is showing.
 *
 * Everything remote stops at this boundary: the markup is already sanitized, and each image is
 * a `data-src` the reader fills in from the backend, so nothing on screen was loaded by the
 * WebView itself.
 */
export function BrowserPage({
  page,
  content,
  onOpenExternal,
}: {
  page: WebPage
  content: Readable
  onOpenExternal: () => void
}) {
  const { t } = useTranslation()

  if (page.kind === 'text') {
    return (
      <article className="ah-prose ah-reader">
        <pre className="ah-reader-text">{content.text}</pre>
      </article>
    )
  }

  if (content.empty) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <EmptyState
          icon={FileQuestion}
          title={t('browser.emptyTitle')}
          hint={t('browser.emptyHint')}
          action={
            <Button variant="secondary" size="sm" onClick={onOpenExternal}>
              <ExternalLink className="size-3.5" aria-hidden />
              {t('browser.openExternal')}
            </Button>
          }
        />
        {content.links.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-faint text-[0.6875rem] tracking-wide uppercase">
              {t('browser.linksOnPage')}
            </p>
            <ul className="flex flex-col gap-1.5">
              {content.links.slice(0, 12).map((link) => (
                <li key={link.url}>
                  <PageLink link={link} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      {page.truncated ? (
        <p className="text-warning-fg flex items-center gap-2 text-[0.75rem]">
          <CircleAlert className="size-3.5 shrink-0" aria-hidden />
          {t('browser.truncated')}
        </p>
      ) : null}
      <article
        className="ah-prose ah-reader"
        // Sanitized in `readable()`: markup that reached here survived an allow-list, and no
        // URL in it points anywhere Ahabby does not fetch itself.
        dangerouslySetInnerHTML={{ __html: content.html }}
      />
    </div>
  )
}

/** One link of a page whose article could not be read: the reader still offers the way in. */
function PageLink({ link }: { link: ReadableLink }) {
  return (
    <a
      href={link.url}
      rel="noreferrer"
      title={link.url}
      className="text-accent-strong text-[0.8125rem] break-words underline underline-offset-4"
    >
      {link.text}
    </a>
  )
}

/** The favicon of a page, carried through the same proxy as every other image of it. */
export function PageIcon({ url }: { url: string | null }) {
  const [icon, setIcon] = useState<{ url: string | null; source: string | null }>({
    url: null,
    source: null,
  })

  useEffect(() => {
    if (!url) return
    let cancelled = false
    void proxiedImage(url).then((source) => {
      if (!cancelled) setIcon({ url, source })
    })
    return () => {
      cancelled = true
    }
  }, [url])

  // The icon of one page is never shown for another while the new one is on its way.
  const source = icon.url === url ? icon.source : null
  if (!source) return <Globe className="text-faint size-4 shrink-0" aria-hidden />
  return <img src={source} alt="" className="size-4 shrink-0 rounded-sm" />
}

/** What the reader shows while a page is on its way. */
export function BrowserSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4" aria-busy="true">
      <Skeleton className="h-6 w-2/3" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-11/12" />
        <Skeleton className="h-3 w-4/5" />
      </div>
      <Skeleton className="h-3 w-1/3" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-10/12" />
      </div>
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  )
}

/**
 * A page the reader will not show: a PDF, a type it has no renderer for, a stale link.
 *
 * The honest end of the road is the user's own browser, so the card always offers it.
 */
export function BrowserRefusal({
  error,
  onOpenExternal,
}: {
  error: unknown
  onOpenExternal: () => void
}) {
  const { t } = useTranslation()
  const code = toAppError(error).code

  if (code === 'not_supported') {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <EmptyState
          icon={AlertTriangle}
          title={t('browser.unsupportedTitle')}
          hint={toAppError(error).message}
          action={
            <Button variant="secondary" size="sm" onClick={onOpenExternal}>
              <ExternalLink className="size-3.5" aria-hidden />
              {t('browser.openExternal')}
            </Button>
          }
        />
      </div>
    )
  }

  return <ErrorState error={error} className="mx-auto max-w-2xl" />
}

/**
 * Load the images of the article on demand.
 *
 * The caretaker is the scroll container the article sits in (`parentElement` of `container`):
 * an observer rooted at the viewport would treat a 20 000-pixel article as "on screen" and fetch
 * every picture of it at once.
 */
export function useProxiedImages(container: RefObject<HTMLElement | null>, images: string[]) {
  useEffect(() => {
    const host = container.current
    if (!host || images.length === 0) return

    let cancelled = false
    const show = (image: HTMLImageElement) => {
      const source = image.dataset.src
      if (!source || image.dataset.loaded) return
      image.dataset.loaded = 'true'
      void proxiedImage(source).then((dataUrl) => {
        if (cancelled) return
        if (!dataUrl) {
          image.remove()
          return
        }
        image.src = dataUrl
        image.removeAttribute('data-src')
      })
    }

    const nodes = [...host.querySelectorAll<HTMLImageElement>('img[data-src]')]
    // No observer (an old WebView, and jsdom in the tests): every image is simply fetched at once.
    if (typeof IntersectionObserver === 'undefined') {
      nodes.forEach(show)
      return () => {
        cancelled = true
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          observer.unobserve(entry.target)
          show(entry.target as HTMLImageElement)
        }
      },
      { root: host.parentElement, rootMargin: '600px 0px' },
    )
    nodes.forEach((node) => observer.observe(node))
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [container, images])
}
