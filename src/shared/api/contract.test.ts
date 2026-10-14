import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { invoke } from '@tauri-apps/api/core'
import { describe, expect, it, vi } from 'vitest'

import * as events from './events'
import { ipc } from './ipc'

/**
 * The two halves of the IPC boundary cannot be checked by a compiler: Tauri joins them by a
 * string the frontend writes and the backend registers. A rename on either side — or a typo —
 * turns into a command that fails at runtime, in the packaged app, for the user. These cases
 * read both sources of truth and hold them against each other, the way `ManagerIcon.test.tsx`
 * holds the brand tiles against the Rust `Manager` enum.
 */
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.resolve(null)) }))

const ROOT = process.cwd()
const RUST_SRC = join(ROOT, 'src-tauri/src')

/**
 * Commands the backend registers, read out of the `handlers!()` macro in `lib.rs` rather than
 * from a list kept here — a copy would drift exactly the way the real thing does.
 */
function registeredCommands(): Set<string> {
  const source = readFileSync(join(RUST_SRC, 'lib.rs'), 'utf8')
  const body = source.split('macro_rules! handlers')[1]?.split('];')[0] ?? ''
  return new Set([...body.matchAll(/commands::[a-z_]+::([a-z_]+)/g)].map((match) => match[1]!))
}

/** `state.rs` is where an event name is written down once; both sides read it from there. */
function rustEventNames(): Map<string, string> {
  const source = readFileSync(join(RUST_SRC, 'state.rs'), 'utf8')
  const body = source.split('pub mod events')[1]?.split('\n}')[0] ?? ''
  return new Map(
    [...body.matchAll(/pub const ([A-Z_]+): &str = "([^"]+)"/g)].map((match) => [
      match[1]!,
      match[2]!,
    ]),
  )
}

/** Every `*_EVENT` constant `events.ts` exports, which is what the frontend listens for. */
function frontendEventNames(): Set<string> {
  return new Set(
    Object.entries(events)
      .filter(([key]) => key.endsWith('_EVENT'))
      .map(([, value]) => value as string),
  )
}

function rustFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return rustFiles(path)
    return entry.name.endsWith('.rs') ? [path] : []
  })
}

/** Constant names the backend passes to `emit(events::…)` anywhere in its own source. */
function emittedEventConstants(): Set<string> {
  const emitted = new Set<string>()
  for (const file of rustFiles(RUST_SRC)) {
    for (const match of readFileSync(file, 'utf8').matchAll(/emit\(\s*events::([A-Z_]+)/g)) {
      emitted.add(match[1]!)
    }
  }
  return emitted
}

type AnyMethod = (...args: unknown[]) => unknown

describe('IPC contract', () => {
  it('every wrapper invokes a command the backend registers', () => {
    const registered = registeredCommands()
    expect(registered.size).toBeGreaterThan(50)
    const calls = vi.mocked(invoke)

    const unknown: string[] = []
    const silent: string[] = []
    for (const [name, method] of Object.entries(ipc) as [string, AnyMethod][]) {
      calls.mockClear()
      // Args are not the subject here: the wrapper only builds the payload object out of them,
      // and `invoke` is a stub, so an `undefined` per parameter is enough to reach the command.
      expect(() => method(), name).not.toThrow()
      const command = calls.mock.calls[0]?.[0]
      if (typeof command !== 'string') silent.push(name)
      else if (!registered.has(command)) unknown.push(`${name} → ${command}`)
    }

    expect(silent, 'wrappers that never called invoke').toEqual([])
    expect(unknown, 'commands the backend does not register').toEqual([])
  })

  it('leaves no registered command without a wrapper, beyond the ones Rust calls itself', () => {
    const calls = vi.mocked(invoke)
    const invoked = new Set<string>()
    for (const [, method] of Object.entries(ipc) as [string, AnyMethod][]) {
      calls.mockClear()
      method()
      const command = calls.mock.calls[0]?.[0]
      if (typeof command === 'string') invoked.add(command)
    }

    // The window's theme is painted from `run()`'s own setup, while the window is still hidden —
    // it is the one command no screen ever needs to call.
    const rustOnly = ['paint_startup_window_theme']
    const orphaned = [...registeredCommands()].filter(
      (command) => !invoked.has(command) && !rustOnly.includes(command),
    )

    expect(orphaned, 'registered but unreachable from the frontend').toEqual([])
    // …and the exception list itself may not rot: each entry must still be a real command.
    expect(rustOnly.filter((command) => !registeredCommands().has(command))).toEqual([])
  })
})

describe('event contract', () => {
  it('declares the same event names on both sides', () => {
    const rust = rustEventNames()
    const ts = frontendEventNames()

    expect(rust.size).toBeGreaterThan(8)
    expect([...rust.values()].sort()).toEqual([...ts].sort())
  })

  it('has a listener for every event the backend emits', () => {
    const rust = rustEventNames()
    const ts = frontendEventNames()

    const missing = [...emittedEventConstants()].filter((constant) => {
      const value = rust.get(constant)
      // An emit of a constant `state.rs` does not declare is a name nothing can listen for.
      return value === undefined || !ts.has(value)
    })

    expect(missing, 'events emitted by the backend that no screen subscribes to').toEqual([])
  })

  it('keeps one exported constant per name', () => {
    const exported = Object.entries(events).filter(([key]) => key.endsWith('_EVENT'))
    const values = exported.map(([, value]) => value as string)

    expect(new Set(values).size).toBe(values.length)
  })
})
