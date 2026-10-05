import { describe, expect, it } from 'vitest'

import { keepsNativeMenu, suppressNativeMenu } from './nativeMenu'

function element(markup: string): Element {
  const host = document.createElement('div')
  host.innerHTML = markup
  return host.firstElementChild ?? host
}

describe('keepsNativeMenu', () => {
  it('keeps the browser menu where it is the only clipboard UI', () => {
    expect(keepsNativeMenu(element('<input />'))).toBe(true)
    expect(keepsNativeMenu(element('<textarea></textarea>'))).toBe(true)
    expect(keepsNativeMenu(element('<select></select>'))).toBe(true)
    expect(keepsNativeMenu(element('<div contenteditable="true"></div>'))).toBe(true)
    expect(keepsNativeMenu(element('<div data-native-menu></div>'))).toBe(true)
  })

  it('keeps it for a node nested in the config editor', () => {
    const editor = element('<div class="cm-editor"><div class="cm-content">x</div></div>')

    expect(keepsNativeMenu(editor.querySelector('.cm-content'))).toBe(true)
  })

  it('cancels it everywhere else, including inside a card', () => {
    expect(keepsNativeMenu(element('<div><p>card</p><button>Install</button></div>'))).toBe(false)
  })

  it('ignores targets that are not elements', () => {
    expect(keepsNativeMenu(null)).toBe(false)
    expect(keepsNativeMenu(document)).toBe(false)
  })
})

describe('suppressNativeMenu', () => {
  it('prevents the default menu outside editable zones only', () => {
    const host = document.createElement('div')
    host.innerHTML = '<p id="card">card</p><input id="field" />'
    document.body.appendChild(host)

    const stop = suppressNativeMenu(document)
    try {
      const contextMenu = () => new MouseEvent('contextmenu', { bubbles: true, cancelable: true })

      expect(document.getElementById('card')!.dispatchEvent(contextMenu())).toBe(false)
      expect(document.getElementById('field')!.dispatchEvent(contextMenu())).toBe(true)
    } finally {
      stop()
      host.remove()
    }
  })

  it('stops listening once unsubscribed', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)

    const stop = suppressNativeMenu(document)
    stop()

    try {
      expect(
        host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
      ).toBe(true)
    } finally {
      host.remove()
    }
  })
})
