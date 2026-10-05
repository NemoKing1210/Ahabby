/**
 * Typed access to the backend's event bus.
 *
 * Two families of events: install/update jobs (`job://…`) and scans (`scan://…`). Event names
 * must match `state::events` in Rust (asserted by `src-tauri/src/state.rs` tests).
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import type { Agent } from '@/shared/bindings/Agent'
import type { JobOutcome } from '@/shared/bindings/JobOutcome'
import type { JobOutputEvent } from '@/shared/bindings/JobOutputEvent'
import type { ScanReport } from '@/shared/bindings/ScanReport'
import type { TerminalExit } from '@/shared/bindings/TerminalExit'
import type { TerminalOutput } from '@/shared/bindings/TerminalOutput'

export const JOB_OUTPUT_EVENT = 'job://output'
export const JOB_DONE_EVENT = 'job://done'
export const SCAN_START_EVENT = 'scan://start'
export const SCAN_AGENT_EVENT = 'scan://agent'
export const SCAN_DONE_EVENT = 'scan://done'
export const TERMINAL_OUTPUT_EVENT = 'terminal://output'
export const TERMINAL_EXIT_EVENT = 'terminal://exit'

export function onJobOutput(handler: (event: JobOutputEvent) => void): Promise<UnlistenFn> {
  return listen<JobOutputEvent>(JOB_OUTPUT_EVENT, (event) => {
    handler(event.payload)
  })
}

export function onJobDone(handler: (outcome: JobOutcome) => void): Promise<UnlistenFn> {
  return listen<JobOutcome>(JOB_DONE_EVENT, (event) => {
    handler(event.payload)
  })
}

/** A scan started: nothing has been inspected yet. */
export function onScanStart(handler: () => void): Promise<UnlistenFn> {
  return listen(SCAN_START_EVENT, () => {
    handler()
  })
}

/** One agent finished scanning — its entry is final for this scan. */
export function onAgentScanned(handler: (agent: Agent) => void): Promise<UnlistenFn> {
  return listen<Agent>(SCAN_AGENT_EVENT, (event) => {
    handler(event.payload)
  })
}

/** The whole report is ready. */
export function onScanDone(handler: (report: ScanReport) => void): Promise<UnlistenFn> {
  return listen<ScanReport>(SCAN_DONE_EVENT, (event) => {
    handler(event.payload)
  })
}

/** A chunk of a terminal session's output: base64 bytes, decoded by the terminal itself. */
export function onTerminalOutput(handler: (event: TerminalOutput) => void): Promise<UnlistenFn> {
  return listen<TerminalOutput>(TERMINAL_OUTPUT_EVENT, (event) => {
    handler(event.payload)
  })
}

/** The process inside a terminal session ended; the tab stays open until it is closed. */
export function onTerminalExit(handler: (event: TerminalExit) => void): Promise<UnlistenFn> {
  return listen<TerminalExit>(TERMINAL_EXIT_EVENT, (event) => {
    handler(event.payload)
  })
}
