import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { ConfigSnapshot } from '@/shared/bindings/ConfigSnapshot'
import type { DiffPreview } from '@/shared/bindings/DiffPreview'
import { ipc } from '@/shared/api/ipc'
import { renderWithProviders } from '@/test/render'

import { DocumentEditorDialog } from './DocumentEditorDialog'

/**
 * The dialog's contract with the user: nothing reaches the disk before the backend has
 * validated the exact text on screen, and a draft can always be thrown away.
 *
 * CodeMirror itself is replaced by a textarea — the editor's own rendering is verified in the
 * app, and these tests are about the dialog's state machine, not about CodeMirror.
 */
vi.mock('@/shared/ui/CodeViewer', () => ({
  CodeViewer: ({
    value,
    editable,
    onChange,
    ariaLabel,
  }: {
    value: string
    editable?: boolean
    onChange?: (value: string) => void
    ariaLabel?: string
  }) => (
    <textarea
      aria-label={ariaLabel}
      readOnly={!editable}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
}))

vi.mock('@/shared/api/ipc', () => ({
  ipc: {
    readConfig: vi.fn(),
    previewConfigSave: vi.fn(),
    saveConfig: vi.fn(),
    listBackups: vi.fn(),
    restoreBackup: vi.fn(),
  },
}))

const AGENT_ID = 'pipeline-demo'
const PATH = '/home/user/.pipeline/settings.json'
const SAVED = '{\n  "theme": "dark"\n}\n'

function snapshot(overrides: Partial<ConfigSnapshot> = {}): ConfigSnapshot {
  return {
    path: PATH,
    format: 'json',
    content: SAVED,
    sha256: 'sha-of-saved',
    sizeBytes: SAVED.length,
    modifiedMs: Date.now(),
    exists: true,
    truncated: false,
    editable: true,
    ...overrides,
  }
}

function preview(overrides: Partial<DiffPreview> = {}): DiffPreview {
  return {
    path: PATH,
    unified: '@@ -1,3 +1,3 @@\n-  "theme": "dark"\n+  "theme": "light"\n',
    added: 1,
    removed: 1,
    errors: [],
    inSync: true,
    currentSha256: 'sha-of-saved',
    ...overrides,
  }
}

function renderDialog(editable = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = renderWithProviders(
    <QueryClientProvider client={client}>
      <DocumentEditorDialog
        agentId={AGENT_ID}
        document={{ path: PATH, label: 'settings.json', format: 'json', editable }}
        onOpenChange={() => undefined}
      />
    </QueryClientProvider>,
  )
  return { ...view, client }
}

/**
 * The textarea the mocked CodeViewer renders. It is found by role, not by label: Radix labels the
 * dialog itself with the title, so `findByLabelText` would return the dialog.
 */
async function editor() {
  return await screen.findByRole('textbox', { name: 'settings.json' })
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DocumentEditorDialog', () => {
  it('keeps Save disabled until the backend has validated the exact draft', async () => {
    vi.mocked(ipc.readConfig).mockResolvedValue(snapshot())
    vi.mocked(ipc.listBackups).mockResolvedValue([])
    vi.mocked(ipc.previewConfigSave).mockResolvedValue(preview())
    renderDialog()

    const box = await editor()
    expect(box).toHaveValue(SAVED)

    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    expect(ipc.previewConfigSave).not.toHaveBeenCalled()

    const edited = SAVED.replace('dark', 'light')
    fireEvent.change(box, { target: { value: edited } })

    await waitFor(() => expect(ipc.previewConfigSave).toHaveBeenCalledTimes(1))
    expect(ipc.previewConfigSave).toHaveBeenCalledWith(AGENT_ID, PATH, edited, 'sha-of-saved')
    await waitFor(() => expect(save).toBeEnabled())
    expect(screen.getByText('1 line added · 1 line removed')).toBeInTheDocument()
  })

  it('shows validation errors and refuses to save', async () => {
    vi.mocked(ipc.readConfig).mockResolvedValue(snapshot())
    vi.mocked(ipc.listBackups).mockResolvedValue([])
    vi.mocked(ipc.previewConfigSave).mockResolvedValue(
      preview({ errors: ['expected `,` at line 2'], added: 0, removed: 0 }),
    )
    renderDialog()

    const box = await editor()
    fireEvent.change(box, { target: { value: '{\n  "theme": "light",,\n}\n' } })

    expect(await screen.findByText('expected `,` at line 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('reverts the draft to the file on disk', async () => {
    vi.mocked(ipc.readConfig).mockResolvedValue(snapshot())
    vi.mocked(ipc.listBackups).mockResolvedValue([])
    vi.mocked(ipc.previewConfigSave).mockResolvedValue(preview())
    renderDialog()

    const box = await editor()
    fireEvent.change(box, { target: { value: 'garbage' } })
    expect(box).toHaveValue('garbage')

    fireEvent.click(screen.getByRole('button', { name: 'Revert to the saved version' }))

    expect(box).toHaveValue(SAVED)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('offers no write actions for a read-only document', async () => {
    vi.mocked(ipc.readConfig).mockResolvedValue(snapshot({ editable: false }))
    vi.mocked(ipc.listBackups).mockResolvedValue([])
    renderDialog(true)

    const box = await editor()
    expect(box).toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    for (const action of ['Undo', 'Redo', 'Revert to the saved version', 'Clear everything']) {
      expect(screen.queryByRole('button', { name: action })).not.toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'Copy contents' })).toBeEnabled()
  })

  it('never raises editability above what the caller asked for', async () => {
    vi.mocked(ipc.readConfig).mockResolvedValue(snapshot({ editable: true }))
    vi.mocked(ipc.listBackups).mockResolvedValue([])
    renderDialog(false)

    const box = await editor()
    expect(box).toHaveAttribute('readonly')
    expect(screen.getByText('Read-only')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Clear everything' })).not.toBeInTheDocument()
  })

  it('asks for a reload when the file changed on disk', async () => {
    vi.mocked(ipc.readConfig).mockResolvedValue(snapshot())
    vi.mocked(ipc.listBackups).mockResolvedValue([])
    vi.mocked(ipc.previewConfigSave).mockRejectedValue({
      code: 'stale_file',
      message: 'the file changed',
    })
    renderDialog()

    const box = await editor()
    fireEvent.change(box, { target: { value: SAVED.replace('dark', 'light') } })

    expect(
      await screen.findByText('This file changed on disk since you opened it.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})
