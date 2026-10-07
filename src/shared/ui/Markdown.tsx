import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useMemo } from 'react'

import { cn } from '@/shared/lib/cn'
import { linkTarget } from '@/shared/lib/links'

/**
 * Renders markdown from the user's own files (skills, instructions) as HTML.
 *
 * Everything is sanitized before it is inserted: these files can come from a repository the
 * user cloned, so treating their content as trusted would be a mistake even in a desktop app.
 *
 * The second pass is about *where a link goes*. A document Ahabby merely displays has no site
 * behind it, so a relative or in-page href would be resolved by the WebView against Ahabby's own
 * origin — clicking one used to take the whole interface down. A link the reader cannot open
 * therefore keeps its text and loses its `href`, while a host written without a scheme
 * (`docs.example.com`) is completed into one, so the useful links of a document stay useful.
 */
export function Markdown({ source, className }: { source: string; className?: string }) {
  const html = useMemo(() => {
    const rendered = marked.parse(source, { async: false, gfm: true, breaks: false })
    const clean = DOMPurify.sanitize(rendered, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['style', 'form', 'input', 'iframe', 'script'],
      FORBID_ATTR: ['style', 'onerror', 'onload'],
    })
    return resolveLinks(clean)
  }, [source])

  return (
    <div
      className={cn('ah-prose', className)}
      // Sanitized above; `dangerouslySetInnerHTML` is the only way to inject rendered markdown.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

/** Point every anchor at an address the reader opens, or take the link out of it. */
function resolveLinks(html: string): string {
  const holder = document.createElement('div')
  holder.innerHTML = html

  for (const anchor of [...holder.querySelectorAll('a')]) {
    const target = linkTarget(anchor.getAttribute('href'))
    if (target.kind === 'reader') anchor.setAttribute('href', target.url)
    // Nothing to open: the text stays, the link goes — an anchor with no address would still be
    // painted and underlined like one.
    else anchor.replaceWith(...anchor.childNodes)
  }

  return holder.innerHTML
}
