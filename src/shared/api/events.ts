/**
 * Typed access to the backend's event bus.
 *
 * Only two events exist: install/update output lines and the final job outcome. Event names
 * must match `state::events` in Rust (asserted by `src-tauri/src/state.rs` tests).
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import type { JobOutcome } from '@/shared/bindings/JobOutcome'
import type { JobOutputEvent } from '@/shared/bindings/JobOutputEvent'

export const JOB_OUTPUT_EVENT = 'job://output'
export const JOB_DONE_EVENT = 'job://done'

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
