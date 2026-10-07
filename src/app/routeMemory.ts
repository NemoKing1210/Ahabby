/**
 * The screen the window was on, restored at startup.
 *
 * `boot()` calls this once, with the remembered route it read from settings and *before* the
 * router is created, so the first frame is already the right screen: navigating after mount would
 * paint home first and fade the splash out over it.
 *
 * Routing is hash-based (`createHashRouter`), so putting the route back is a matter of setting the
 * hash — the router reads the URL when it is built.
 *
 * A hash the app was started with wins: a reload, a bookmark or a deep link is what the user asked
 * for, while the remembered route is only the fallback for a window that was opened bare.
 */
export function applyRememberedRoute(route: string | null | undefined): boolean {
  if (!route || route === '/') return false

  const current = window.location.hash.replace(/^#/, '')
  if (current && current !== '/') return false

  window.location.hash = route
  return true
}
