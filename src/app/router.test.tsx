import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import { matchRoutes, type RouteObject } from 'react-router-dom'

import { settingsRoutes } from '@/features/settings/routes'

import { routes } from './router'

/**
 * The route table is a string-keyed contract with three independent callers — the sidebar, the
 * tray and the home screen — and none of them can be checked by a compiler. A path that stops
 * existing is not an error: the router's own `*` sends the user to the home screen, so a typo
 * looks like a wrong click rather than a broken build. These cases hold every navigable path
 * against the table, including the ones Rust decides.
 *
 * `matchRoutes` is React Router's own matcher, so a case cannot disagree with the router about
 * what a path means.
 */
const APP_SHELL = join(process.cwd(), 'src/app/layouts/AppShell.tsx')
const TRAY = join(process.cwd(), 'src-tauri/src/desktop/tray.rs')

/** A child's path is relative to its parent's, exactly as React Router resolves it. */
function joinPath(prefix: string, segment: string | undefined): string {
  if (!segment) return prefix || '/'
  if (segment.startsWith('/')) return segment
  return `${prefix === '/' ? '' : prefix}/${segment}`
}

/** Routes the router actually declares, as the full paths a link would use. */
function declaredPaths(table: RouteObject[]): string[] {
  const paths: string[] = []
  const walk = (entries: RouteObject[], prefix: string) => {
    for (const entry of entries) {
      const full = joinPath(prefix, entry.path)
      if (entry.path && entry.path !== '*') paths.push(full)
      if (entry.children) walk(entry.children, full)
    }
  }
  walk(table, '')
  return paths
}

/** Whether a path resolves to a screen rather than to the `*` catch-all. */
function resolvesToAScreen(hash: string): boolean {
  const matches = matchRoutes(routes, hash)
  const last = matches?.[matches.length - 1]?.route
  return last !== undefined && last.path !== '*'
}

/** The sidebar's own entries: what the rail offers must be reachable. */
function sidebarTargets(): string[] {
  return [...readFileSync(APP_SHELL, 'utf8').matchAll(/\{\s*to: '([^']+)'/g)].map(
    (match) => match[1]!,
  )
}

/**
 * The tray's `Go to` entries, read out of Rust: the menu is planned there, and a route it names
 * is a route the window must have — nothing else links the two.
 */
function trayTargets(): string[] {
  const body = readFileSync(TRAY, 'utf8').split('const DESTINATIONS')[1]?.split('];')[0] ?? ''
  return [...body.matchAll(/\("([^"]+)",\s*"[^"]+"\)/g)].map((match) => match[1]!)
}

describe('routes', () => {
  it('resolves every path it declares', () => {
    const declared = [...declaredPaths(routes), ...declaredPaths(settingsRoutes)]

    expect(declared.length).toBeGreaterThan(8)
    for (const path of declared) {
      if (path.includes(':')) {
        // A parameterised path is only reachable with something in the slot.
        expect(resolvesToAScreen(path.replace(/:[^/]+/g, 'example')), path).toBe(true)
      } else if (path !== '*') {
        expect(resolvesToAScreen(path), path).toBe(true)
      }
    }
  })

  it('has a screen for every sidebar entry', () => {
    const targets = sidebarTargets()
    expect(targets.length).toBeGreaterThan(4)
    for (const target of targets) expect(resolvesToAScreen(target), target).toBe(true)
  })

  it('has a screen for every tray entry', () => {
    const targets = trayTargets()
    expect(targets.length).toBeGreaterThan(3)
    for (const target of targets) expect(resolvesToAScreen(target), target).toBe(true)
  })

  it('sends an unknown path to the home screen instead of nowhere', () => {
    expect(resolvesToAScreen('/definitely-not-a-screen')).toBe(false)

    const matches = matchRoutes(routes, '/definitely-not-a-screen')
    expect(matches?.[matches.length - 1]?.route.path).toBe('*')
  })
})
