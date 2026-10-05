import { Suspense, lazy } from 'react'

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
          className="border-border bg-surface-2 h-[50vh] animate-pulse rounded-lg border"
        />
      }
    >
      <LazyCodeViewer {...props} />
    </Suspense>
  )
}

export type { CodeViewerProps }
