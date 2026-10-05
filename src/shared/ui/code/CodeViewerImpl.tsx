import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { yaml } from '@codemirror/lang-yaml'
import { StreamLanguage } from '@codemirror/language'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { EditorView } from '@codemirror/view'
import CodeMirror, { type ReactCodeMirrorProps } from '@uiw/react-codemirror'
import { useMemo } from 'react'

import type { ConfigFormat } from '@/shared/bindings/ConfigFormat'
import { cn } from '@/shared/lib/cn'

/**
 * CodeMirror 6 wrapper used for both viewing and editing configs.
 *
 * The theme reads the design tokens, so the editor follows the app theme automatically
 * (including the automatic dark mode) without a second theme definition.
 */
const editorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-foreground)',
    fontSize: '12.5px',
  },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
  '.cm-content': { padding: '10px 0', caretColor: 'var(--color-accent)' },
  '.cm-gutters': {
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-faint)',
    border: 'none',
    paddingRight: '4px',
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklab, var(--color-accent) 6%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--color-muted)' },
  '.cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in oklab, var(--color-accent) 25%, transparent)',
  },
  '.cm-cursor': { borderLeftColor: 'var(--color-accent)' },
  '&.cm-focused': { outline: 'none' },
})

function extensionsFor(format: ConfigFormat) {
  switch (format) {
    case 'json':
    case 'jsonc':
      return [json()]
    case 'yaml':
      return [yaml()]
    case 'markdown':
      return [markdown()]
    case 'toml':
      return [StreamLanguage.define(toml)]
    default:
      return []
  }
}

export interface CodeViewerProps {
  value: string
  format: ConfigFormat
  editable?: boolean
  onChange?: (value: string) => void
  height?: string
  className?: string
  ariaLabel?: string
}

export default function CodeViewer({
  value,
  format,
  editable = false,
  onChange,
  height = '50vh',
  className,
  ariaLabel,
}: CodeViewerProps) {
  const extensions = useMemo(() => [...extensionsFor(format), editorTheme], [format])
  const options: Partial<ReactCodeMirrorProps> = editable
    ? { editable: true, onChange }
    : { editable: false, readOnly: true }

  return (
    <div className={cn('border-border bg-surface overflow-hidden rounded-lg border', className)}>
      <CodeMirror
        value={value}
        height={height}
        extensions={extensions}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: editable,
          highlightActiveLineGutter: editable,
          autocompletion: false,
          searchKeymap: true,
        }}
        aria-label={ariaLabel}
        {...options}
      />
    </div>
  )
}
