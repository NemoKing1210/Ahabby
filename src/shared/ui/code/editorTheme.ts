import { HighlightStyle } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

/**
 * The editor's look, expressed entirely in design tokens.
 *
 * Nothing here is a literal colour: `--color-*` already resolves the palette (accent, scale and
 * light/dark), so the editor follows the app theme — and any appearance setting — without a
 * second theme definition. That is also why the wrapper passes `theme="none"`: CodeMirror's own
 * `light`/`dark` themes would paint literal colours over these tokens.
 */
export const editorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-foreground)',
    fontSize: '0.8125rem',
    height: '100%',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.65',
    overflow: 'auto',
  },
  '.cm-content': {
    padding: '10px 0',
    caretColor: 'var(--color-accent)',
  },
  // Symmetric breathing room on both sides of the gutter; the numbers sit right-aligned.
  // The line-number gutter needs the same selector depth as CodeMirror's own padding rule to win.
  '.cm-line': { padding: '0 12px 0 10px' },
  '.cm-gutters': {
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-faint)',
    border: 'none',
    borderRight: '1px solid var(--color-border)',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 10px',
    minWidth: '2.5em',
    textAlign: 'right',
    whiteSpace: 'nowrap',
  },
  '.cm-foldGutter .cm-gutterElement': { padding: '0 6px 0 0' },
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in oklab, var(--color-accent) 7%, transparent)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'color-mix(in oklab, var(--color-accent) 7%, transparent)',
    color: 'var(--color-muted)',
  },
  '.cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'color-mix(in oklab, var(--color-accent) 28%, transparent)',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-accent)' },
  '.cm-selectionMatch': {
    backgroundColor: 'color-mix(in oklab, var(--color-accent) 16%, transparent)',
  },
  '.cm-matchingBracket, .cm-nonmatchingBracket': {
    backgroundColor: 'color-mix(in oklab, var(--color-accent) 22%, transparent)',
    outline: 'none',
  },
  '.cm-specialChar': { color: 'var(--color-danger)' },
  '&.cm-focused': { outline: 'none' },

  // Search / replace panel (`Mod-f`), including its inputs and buttons.
  '.cm-panels': {
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-foreground)',
    borderTop: '1px solid var(--color-border)',
  },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--color-border)', borderTop: 'none' },
  '.cm-panel.cm-search': {
    padding: '8px 10px',
    fontFamily: 'var(--font-sans)',
    fontSize: '0.75rem',
  },
  '.cm-panel.cm-search label': { display: 'inline-flex', alignItems: 'center', gap: '4px' },
  '.cm-textfield': {
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-foreground)',
    border: '1px solid var(--color-border-strong)',
    borderRadius: 'var(--radius-sm)',
    padding: '3px 8px',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.75rem',
    outline: 'none',
  },
  '.cm-textfield:focus': { borderColor: 'var(--color-accent)' },
  '.cm-button': {
    background: 'var(--color-surface)',
    backgroundImage: 'none',
    color: 'var(--color-foreground)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    padding: '3px 10px',
    fontFamily: 'var(--font-sans)',
    fontSize: '0.75rem',
    cursor: 'pointer',
  },
  '.cm-button:hover': { backgroundColor: 'var(--color-surface-3)' },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in oklab, var(--color-warning) 30%, transparent)',
    outline: 'none',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in oklab, var(--color-accent) 40%, transparent)',
  },

  // Autocomplete and lint tooltips, in case a caller adds those extensions later.
  '.cm-tooltip': {
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-foreground)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--shadow-popover)',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--color-accent-soft)',
    color: 'var(--color-foreground)',
  },
})

/**
 * Token colours for the languages we ship.
 *
 * Every colour is a `-fg` token, which the palette defines separately for light and dark, so the
 * same style stays readable in both. The wrapper adds it as a real `syntaxHighlighting` extension,
 * which takes precedence over the light default the basic setup installs as a fallback.
 */
export const editorHighlightStyle = HighlightStyle.define([
  {
    tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
    color: 'var(--color-faint)',
    fontStyle: 'italic',
  },
  {
    tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.self, t.null, t.atom],
    color: 'var(--color-accent-strong)',
  },
  { tag: [t.string, t.character, t.regexp, t.special(t.string)], color: 'var(--color-success-fg)' },
  { tag: [t.number, t.integer, t.float, t.bool], color: 'var(--color-info-fg)' },
  {
    tag: [t.propertyName, t.attributeName, t.definition(t.propertyName)],
    color: 'var(--color-foreground)',
  },
  { tag: [t.variableName, t.local(t.variableName), t.name], color: 'var(--color-foreground)' },
  {
    tag: [t.typeName, t.className, t.namespace, t.tagName, t.standard(t.tagName)],
    color: 'var(--color-warning-fg)',
  },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName],
    color: 'var(--color-info-fg)',
  },
  { tag: [t.punctuation, t.bracket, t.separator, t.operator], color: 'var(--color-muted)' },
  {
    tag: [t.heading, t.heading1, t.heading2, t.heading3],
    color: 'var(--color-foreground)',
    fontWeight: '600',
  },
  {
    tag: [t.heading4, t.heading5, t.heading6],
    color: 'var(--color-foreground)',
    fontWeight: '500',
  },
  { tag: t.strong, fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: [t.link, t.url], color: 'var(--color-info-fg)', textDecoration: 'underline' },
  { tag: [t.strikethrough, t.deleted], textDecoration: 'line-through' },
  { tag: t.inserted, color: 'var(--color-success-fg)' },
  { tag: t.invalid, color: 'var(--color-danger-fg)' },
  { tag: t.meta, color: 'var(--color-muted)' },
])
