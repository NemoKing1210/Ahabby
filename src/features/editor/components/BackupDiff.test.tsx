import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderWithProviders } from '@/test/render'

import { BackupDiff } from './BackupDiff'

const OLD = '{\n  "theme": "light"\n}\n'
const NEW = '{\n  "theme": "dark"\n}\n'

function renderDiff(oldText: string, newText: string) {
  return renderWithProviders(
    <BackupDiff
      oldText={oldText}
      newText={newText}
      leftLabel="Backup"
      rightLabel="Current version"
    />,
  )
}

describe('BackupDiff', () => {
  it('shows both sides, then folds them into one list with markers', () => {
    renderDiff(OLD, NEW)

    expect(screen.getByText('Backup')).toBeInTheDocument()
    expect(screen.getByText('Current version')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Unified' }))

    expect(screen.queryByText('Backup')).toBeNull()
    expect(screen.queryByText('Current version')).toBeNull()
    expect(screen.getAllByText('-').length).toBeGreaterThan(0)
    expect(screen.getAllByText('+').length).toBeGreaterThan(0)
  })

  it('says so when the backup and the current text are identical', () => {
    renderDiff(OLD, OLD)

    expect(screen.getByText('This backup is identical to the current version.')).toBeInTheDocument()
  })
})
