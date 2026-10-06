import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { AgentRef } from '@/shared/bindings/AgentRef'
import { Button } from '@/shared/ui/Button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { FormField } from '@/shared/ui/FormField'
import { Input } from '@/shared/ui/Input'
import { OwnerSelect } from '@/shared/ui/OwnerSelect'
import { Textarea } from '@/shared/ui/Textarea'
import { toast, toastAppError } from '@/shared/ui/Toast'

import { useCreateSkill } from '../api/hooks'

/**
 * Create a skill of your own.
 *
 * The directory name is derived from the name — the backend writes
 * `<owner's skills dir>/<slug>/SKILL.md` — so the name is the only thing the form insists on.
 * The owner is a choice only in the Library; on an agent page there is exactly one.
 */
export function CreateSkillDialog({
  owners,
  onClose,
}: {
  owners: AgentRef[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const create = useCreateSkill()

  const [ownerId, setOwnerId] = useState(owners[0]?.id ?? '')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')

  const trimmedName = name.trim()
  const valid = trimmedName.length > 0 && ownerId.length > 0

  const submit = () => {
    if (!valid) return
    create.mutate(
      {
        agentId: ownerId,
        draft: {
          name: trimmedName,
          description: description.trim() || null,
          content: content.trim() || null,
        },
      },
      {
        onSuccess: (result) => {
          toast.success(t('skills.created', { name: result.data.name }))
          onClose()
        },
        // A refused write keeps the form open: the message says what to fix.
        onError: (error) => toastAppError(error),
      },
    )
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="w-[min(640px,92vw)]">
        <DialogHeader>
          <DialogTitle>{t('skills.createTitle')}</DialogTitle>
          <DialogDescription>{t('skills.createBody')}</DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          <OwnerSelect
            label={t('skills.createOwner')}
            hint={owners.length > 1 ? t('skills.createOwnerHint') : undefined}
            owners={owners}
            value={ownerId}
            onChange={setOwnerId}
          />

          <FormField
            label={t('skills.createName')}
            htmlFor="create-skill-name"
            hint={t('skills.createNameHint')}
          >
            <Input
              id="create-skill-name"
              autoFocus
              value={name}
              maxLength={80}
              placeholder={t('skills.createNamePlaceholder')}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit()
              }}
            />
          </FormField>

          <FormField label={t('skills.createDescription')} htmlFor="create-skill-description">
            <Input
              id="create-skill-description"
              value={description}
              maxLength={200}
              placeholder={t('skills.createDescriptionPlaceholder')}
              onChange={(event) => setDescription(event.target.value)}
            />
          </FormField>

          <FormField
            label={t('skills.createContent')}
            htmlFor="create-skill-content"
            hint={t('skills.createContentHint')}
          >
            <Textarea
              id="create-skill-content"
              rows={7}
              value={content}
              placeholder={t('skills.createContentPlaceholder')}
              onChange={(event) => setContent(event.target.value)}
            />
          </FormField>
        </DialogBody>

        <div className="border-border flex items-center justify-end gap-2 border-t px-6 py-4">
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} disabled={!valid || create.isPending}>
            {t('skills.createSubmit')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
