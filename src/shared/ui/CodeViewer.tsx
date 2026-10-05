import { Suspense, lazy } from 'react'

import { cn } from '@/shared/lib/cn'

import type { CodeViewerProps } from './code/CodeViewerImpl'

const LazyCodeViewer = lazy(() => import('./code/CodeViewerImpl'))

/**
 * CodeMirror is by far the heaviest dependency in the app (~1 MB minified) and only the
 * editor screens need it, so it is loaded on demand. Everything else — the agent list, the
 * library, the sidebar — renders without waiting for it.
 *
 * The public API of this module is unchanged for callers.
 */
export function CodeViewer(props: CodeViewerProps) {
  return (
    <Suspense
      fallback={
        <div
          aria-busy="true"
          style={{ height: props.height ?? '50vh' }}
          className={cn(
            'border-border bg-surface-2 animate-pulse rounded-lg border',
            props.className,
          )}
        />
      }
    >
      <LazyCodeViewer {...props} />
    </Suspense>
  )
}

export type { CodeViewerProps }
