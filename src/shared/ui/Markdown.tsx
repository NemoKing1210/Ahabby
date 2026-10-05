import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useMemo } from 'react'

import { cn } from '@/shared/lib/cn'

/**
 * Renders markdown from the user's own files (skills, instructions) as HTML.
 *
 * Everything is sanitized before it is inserted: these files can come from a repository the
 * user cloned, so treating their content as trusted would be a mistake even in a desktop app.
 */
export function Markdown({ source, className }: { source: string; className?: string }) {
  const html = useMemo(() => {
    const rendered = marked.parse(source, { async: false, gfm: true, breaks: false })
    return DOMPurify.sanitize(rendered, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['style', 'form', 'input', 'iframe', 'script'],
      FORBID_ATTR: ['style', 'onerror', 'onload'],
    })
  }, [source])

  return (
    <div
      className={cn('ah-prose', className)}
      // Sanitized above; `dangerouslySetInnerHTML` is the only way to inject rendered markdown.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
