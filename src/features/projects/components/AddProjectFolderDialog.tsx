import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderSearch } from 'lucide-react'

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
import { toast, toastAppError } from '@/shared/ui/Toast'

import { useAddProjectFolder, usePickProjectFolder } from '../api/hooks'

/**
 * Adds a folder to the Projects screen.
 *
 * "Choose folder…" opens the operating system's own picker (the backend asks for it and answers
 * with a path); typing a path stays possible for a folder the picker cannot reach. Either way
 * the folder is only remembered once Add is pressed, and the dialog stays open on failure so
 * the path can be corrected.
 */
export function AddProjectFolderDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const add = useAddProjectFolder()
  const pick = usePickProjectFolder()
  const [path, setPath] = useState('')
  const trimmed = path.trim()

  const choose = () => {
    pick.mutate(undefined, {
      // A cancelled dialog answers `null`, which is not an error and changes nothing.
      onSuccess: (picked) => {
        if (picked) setPath(picked)
      },
      onError: (error) => toastAppError(error),
    })
  }

  const submit = () => {
    if (!trimmed) return
    add.mutate(trimmed, {
      onSuccess: (result) => {
        toast.success(t('projects.added', { path: result.data.path }))
        const found = result.report.projects.projects.filter(
          (project) => project.folderId === result.data.id,
        ).length
        if (found > 0) toast.success(t('projects.addedFound', { count: found }))
        onClose()
      },
      onError: (error) => toastAppError(error),
    })
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="w-[min(600px,92vw)]">
        <DialogHeader>
          <DialogTitle>{t('projects.addTitle')}</DialogTitle>
          <DialogDescription>{t('projects.addBody')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <FormField
            label={t('projects.pathLabel')}
            htmlFor="project-folder-path"
            hint={t('projects.pathHint')}
          >
            <div className="flex items-center gap-2">
              <Input
                id="project-folder-path"
                value={path}
                placeholder={t('projects.pathPlaceholder')}
                onChange={(event) => setPath(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submit()
                }}
              />
              <Button variant="secondary" onClick={choose} loading={pick.isPending}>
                {pick.isPending ? null : <FolderSearch className="size-3.5" aria-hidden />}
                {t('projects.chooseFolder')}
              </Button>
            </div>
          </FormField>
        </DialogBody>
        <div className="border-border flex items-center justify-end gap-2 border-t px-6 py-4">
          <Button variant="ghost" onClick={onClose} disabled={add.isPending}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} disabled={!trimmed} loading={add.isPending}>
            {t('projects.addSubmit')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
