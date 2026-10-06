import { useTranslation } from 'react-i18next'

import type { AgentRef } from '@/shared/bindings/AgentRef'

import { AgentTag } from './AgentTag'
import { FormField } from './FormField'
import { ownerOption } from './agentOptions'
import { Select } from './Select'

/**
 * "Whose skill/server is this?" field of the creation forms.
 *
 * With one owner there is nothing to choose, so the owner is shown as a tag and the form
 * stays a plain description of where the file will be written; with several (the Library,
 * where the shared surface is one of them) it becomes a select. The shared surface is labelled
 * in the UI's language, a real agent keeps the manifest's name.
 */
export function OwnerSelect({
  label,
  hint,
  owners,
  value,
  onChange,
}: {
  label: string
  hint?: string
  owners: AgentRef[]
  value: string
  onChange: (ownerId: string) => void
}) {
  const { t } = useTranslation()
  const [only] = owners
  if (!only) return null

  if (owners.length === 1) {
    return (
      <FormField label={label} hint={hint}>
        <div className="flex h-9 items-center">
          <AgentTag agent={only} />
        </div>
      </FormField>
    )
  }

  return (
    <FormField label={label} hint={hint}>
      <Select
        ariaLabel={label}
        value={value}
        onValueChange={onChange}
        options={owners.map((owner) => ownerOption(owner, t('library.shared')))}
      />
    </FormField>
  )
}
