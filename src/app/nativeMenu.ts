/**
 * The WebView's own context menu.
 *
 * Ahabby is a desktop window, so the browser menu — Back/Forward, Reload, Save as, Print — is
 * never what a right click should offer, and every place that has its own menu already calls
 * `preventDefault()`. Text entry keeps the native menu because it is the only clipboard UI the
 * WebView offers: there is no Tauri clipboard plugin, and `navigator.clipboard` reads are not
 * granted on the custom protocol, so a right click in a field would otherwise have no Paste.
 */

/** Elements whose native menu provides editing actions we cannot reimplement reliably. */
const EDITABLE_ZONE = 'input, textarea, select, [contenteditable], .cm-editor, [data-native-menu]'

/** Whether the browser should still draw its own menu for `target`. */
export function keepsNativeMenu(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(EDITABLE_ZONE) !== null
}

/**
 * Installs the app-wide `contextmenu` guard and returns the unsubscribe. Nothing here
 * suppresses the native *drag* behaviour or the keyboard, only the menu itself.
 */
export function suppressNativeMenu(root: Document = document): () => void {
  const onContextMenu = (event: MouseEvent) => {
    if (!keepsNativeMenu(event.target)) event.preventDefault()
  }

  root.addEventListener('contextmenu', onContextMenu)
  return () => root.removeEventListener('contextmenu', onContextMenu)
}
