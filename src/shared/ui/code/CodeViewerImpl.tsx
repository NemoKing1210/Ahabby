import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { yaml } from '@codemirror/lang-yaml'
import { StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { search } from '@codemirror/search'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import CodeMirror, {
  type ReactCodeMirrorProps,
  type ReactCodeMirrorRef,
} from '@uiw/react-codemirror'
import { useEffect, useMemo, useState, type Ref } from 'react'

import type { ConfigFormat } from '@/shared/bindings/ConfigFormat'
import { cn } from '@/shared/lib/cn'

import { editorHighlightStyle, editorTheme } from './editorTheme'

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

/**
 * Whether the app is in its dark palette right now.
 *
 * Only used to tell CodeMirror which built-in parts (panels, tooltips, special characters) it
 * should treat as dark; every colour still comes from the tokens, so nothing here repaints on its
 * own. The applier toggles `html.dark`, which is what we watch.
 */
function useIsDark(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => setDark(root.classList.contains('dark')))
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return dark
}

export interface CodeViewerProps {
  value: string
  format: ConfigFormat
  editable?: boolean
  onChange?: (value: string) => void
  /** Wraps long lines instead of scrolling horizontally. */
  wrap?: boolean
  /** Receives the editor view after every update (undo depth, focus, ...). */
  onUpdate?: ReactCodeMirrorProps['onUpdate']
  /** Handle on the CodeMirror instance, for imperative actions such as opening the search panel. */
  editorRef?: Ref<ReactCodeMirrorRef | null>
  height?: string
  className?: string
  ariaLabel?: string
}

export default function CodeViewer({
  value,
  format,
  editable = false,
  onChange,
  wrap = false,
  onUpdate,
  editorRef,
  height = '50vh',
  className,
  ariaLabel,
}: CodeViewerProps) {
  const dark = useIsDark()

  const extensions = useMemo(
    () => [
      ...extensionsFor(format),
      editorTheme,
      syntaxHighlighting(editorHighlightStyle),
      // `basicSetup` binds Mod-f but never installs the panel itself.
      search(),
      EditorState.tabSize.of(2),
      EditorView.darkTheme.of(dark),
      ...(wrap ? [EditorView.lineWrapping] : []),
    ],
    [format, dark, wrap],
  )

  const options: Partial<ReactCodeMirrorProps> = editable
    ? { editable: true, onChange }
    : { editable: false, readOnly: true }

  return (
    <div
      className={cn('border-border bg-surface h-full overflow-hidden rounded-lg border', className)}
    >
      <CodeMirror
        ref={editorRef}
        value={value}
        height={height}
        theme="none"
        extensions={extensions}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: editable,
          highlightActiveLineGutter: editable,
          autocompletion: false,
          closeBrackets: editable,
          indentOnInput: editable,
          searchKeymap: true,
          tabSize: 2,
        }}
        onUpdate={onUpdate}
        aria-label={ariaLabel}
        {...options}
      />
    </div>
  )
}
