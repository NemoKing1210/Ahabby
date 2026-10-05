/**
 * Clipboard helper.
 *
 * `navigator.clipboard` needs a secure context, which the Tauri custom protocol is not
 * guaranteed to be, so a `execCommand` fallback is kept for the packaged app.
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fall through to the legacy path
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  try {
    textarea.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(textarea)
  }
}

/**
 * Read the clipboard, or `null` when the webview will not allow it.
 *
 * There is no legacy fallback for reading: the browser's own paste into a focused field (what
 * `Ctrl+V` does in the terminal) is the only reliable path when `navigator.clipboard` is missing,
 * so a caller that gets `null` should say so instead of pasting nothing.
 */
export async function readText(): Promise<string | null> {
  if (navigator.clipboard?.readText) {
    try {
      return await navigator.clipboard.readText()
    } catch {
      return null
    }
  }
  return null
}
