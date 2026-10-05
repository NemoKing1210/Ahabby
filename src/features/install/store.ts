import { create } from 'zustand'

import type { InstallAction } from '@/shared/bindings/InstallAction'
import type { JobOutcome } from '@/shared/bindings/JobOutcome'
import type { JobOutputEvent } from '@/shared/bindings/JobOutputEvent'
import type { StreamKind } from '@/shared/bindings/StreamKind'

/**
 * UI state for install/update jobs.
 *
 * This is the only kind of state Zustand is used for: server state lives in React Query,
 * and the job console is a transient view of a running process.
 */
export interface JobLine {
  stream: StreamKind
  line: string
}

export interface JobView {
  jobId: string
  agentId: string
  action: InstallAction
  command: string
  lines: JobLine[]
  outcome?: JobOutcome
}

interface JobState {
  jobs: Record<string, JobView>
  start: (job: Omit<JobView, 'lines'>) => void
  append: (event: JobOutputEvent) => void
  finish: (outcome: JobOutcome) => void
  clear: (jobId: string) => void
}

const MAX_LINES = 2000

export const useJobStore = create<JobState>((set) => ({
  jobs: {},
  start: (job) =>
    set((state) => ({
      jobs: { ...state.jobs, [job.jobId]: { ...job, lines: [] } },
    })),
  append: (event) =>
    set((state) => {
      const job = state.jobs[event.jobId]
      if (!job) return state
      // Keep the tail: installers can print thousands of lines and the UI only shows the end.
      const lines = [...job.lines, { stream: event.stream, line: event.line }].slice(-MAX_LINES)
      return { jobs: { ...state.jobs, [event.jobId]: { ...job, lines } } }
    }),
  finish: (outcome) =>
    set((state) => {
      const job = state.jobs[outcome.jobId]
      if (!job) return state
      return { jobs: { ...state.jobs, [outcome.jobId]: { ...job, outcome } } }
    }),
  clear: (jobId) =>
    set((state) => {
      const jobs = { ...state.jobs }
      delete jobs[jobId]
      return { jobs }
    }),
}))
