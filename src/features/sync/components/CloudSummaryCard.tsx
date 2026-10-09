import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, CloudDownload, Settings2, UploadCloud } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Reveal } from '@/shared/ui/Reveal'

import { compareOf, viewOfLocal, viewOfRemote } from '../lib/targets'
import { useCloudActions } from './CloudActions'
import { RemoteItemRow, SyncItemRow } from './SyncRows'

/** A set with one entry flipped — what every checkbox in the panel does. */
function toggled(set: Set<string>, value: string, next: boolean): Set<string> {
  const copy = new Set(set)
  if (next) copy.add(value)
  else copy.delete(value)
  return copy
}

/**
 * The Overview's cloud card: an owner's state in one line, the two things worth doing from here —
 * save everything that is not saved yet, or open the copies to restore from — and, behind a
 * disclosure, the files themselves.
 *
 * The disclosure is the deliberate version of those two buttons: what can be uploaded (on disk,
 * not the cloud's copy yet) and what can be restored (the account's copies), each row a checkbox,
 * so a subset is one click away. A restore still goes through a confirmation, because it
 * overwrites this machine.
 */
export function CloudSummaryCard() {
  const { t } = useTranslation()
  const cloud = useCloudActions()
  const [open, setOpen] = useState(false)
  const [uploads, setUploads] = useState<Set<string>>(new Set())
  const [downloads, setDownloads] = useState<Set<string>>(new Set())

  if (!cloud) return null

  if (!cloud.ready) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="flex items-start gap-3">
          <CloudDownload className="text-faint mt-0.5 size-4" aria-hidden />
          <div className="flex flex-col gap-1">
            <span className="text-sm">{t('sync.cardTitle')}</span>
            <p className="text-muted max-w-prose text-[0.8125rem]">
              {cloud.enabled ? t('sync.notConnectedHint') : t('sync.disabledHint')}
            </p>
          </div>
        </div>
        <Button variant="secondary" size="sm" asChild>
          <Link to="/settings/sync">
            <Settings2 className="size-3.5" aria-hidden />
            {t('sync.openSettings')}
          </Link>
        </Button>
      </Card>
    )
  }

  const { unsynced, modified, missing, cloudOnly } = cloud.summary
  // What can be uploaded: on disk, and not the cloud's copy yet.
  const uploadable = cloud.items.filter((item) => item.exists && item.status !== 'synced')
  // What can be restored: every copy the account holds for this owner.
  const copies = cloud.copies
  const selectedUploads = uploadable.filter((item) => uploads.has(item.id))
  const selectedDownloads = copies.filter((copy) => downloads.has(copy.remoteId))

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm">{t('sync.cardTitle')}</span>
          <p className="text-muted text-[0.8125rem]">
            {t('sync.cloudSummary', { unsynced, modified, missing, cloud: cloudOnly })}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            loading={cloud.busy}
            disabled={uploadable.length === 0}
            onClick={() => cloud.saveMany(uploadable)}
          >
            <UploadCloud className="size-3.5" aria-hidden />
            {t('sync.saveAll')}
          </Button>
          <Button variant="secondary" size="sm" onClick={cloud.openRestoreList}>
            <CloudDownload className="size-3.5" aria-hidden />
            {t('sync.restore')}
          </Button>
        </div>
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? (
          <ChevronDown className="size-3.5" aria-hidden />
        ) : (
          <ChevronRight className="size-3.5" aria-hidden />
        )}
        {t('sync.showFiles')}
      </Button>

      <Reveal open={open}>
        <div className="flex flex-col gap-5 pt-1">
          <section aria-label={t('sync.uploadSection')} className="flex flex-col gap-2">
            <header className="flex items-center justify-between gap-2">
              <span className="text-muted text-[0.8125rem]">
                {t('sync.uploadSection')}
                <span className="text-faint ml-1.5 tabular-nums">{uploadable.length}</span>
              </span>
              {uploadable.length > 0 ? (
                <Button
                  variant="link"
                  size="sm"
                  onClick={() =>
                    setUploads(
                      uploads.size === uploadable.length
                        ? new Set()
                        : new Set(uploadable.map((item) => item.id)),
                    )
                  }
                >
                  {uploads.size === uploadable.length
                    ? t('sync.clearSelection')
                    : t('sync.selectAll')}
                </Button>
              ) : null}
            </header>

            {uploadable.length === 0 ? (
              <p className="text-faint text-[0.75rem]">{t('sync.uploadEmpty')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {uploadable.map((item) => {
                  const copy = copies.find((entry) => entry.key === item.key)
                  return (
                    <li key={item.id}>
                      <SyncItemRow
                        item={item}
                        selected={uploads.has(item.id)}
                        onSelect={(next) =>
                          setUploads((previous) => toggled(previous, item.id, next))
                        }
                        onSave={() => cloud.save(item)}
                        onView={() => cloud.view(viewOfLocal(item, cloud.owner))}
                        onCompare={
                          copy
                            ? () =>
                                cloud.compare(
                                  compareOf(copy.remoteId, cloud.owner.id, cloud.owner, item.label),
                                )
                            : undefined
                        }
                        busy={cloud.busy}
                      />
                    </li>
                  )
                })}
              </ul>
            )}

            <div className="flex justify-end">
              <Button
                variant="secondary"
                size="sm"
                disabled={selectedUploads.length === 0 || cloud.busy}
                onClick={() => {
                  cloud.saveMany(selectedUploads)
                  setUploads(new Set())
                }}
              >
                <UploadCloud className="size-3.5" aria-hidden />
                {t('sync.saveSelected', { count: selectedUploads.length })}
              </Button>
            </div>
          </section>

          <section aria-label={t('sync.downloadSection')} className="flex flex-col gap-2">
            <header className="flex items-center justify-between gap-2">
              <span className="text-muted text-[0.8125rem]">
                {t('sync.downloadSection')}
                <span className="text-faint ml-1.5 tabular-nums">{copies.length}</span>
              </span>
              {copies.length > 0 ? (
                <Button
                  variant="link"
                  size="sm"
                  onClick={() =>
                    setDownloads(
                      downloads.size === copies.length
                        ? new Set()
                        : new Set(copies.map((copy) => copy.remoteId)),
                    )
                  }
                >
                  {downloads.size === copies.length
                    ? t('sync.clearSelection')
                    : t('sync.selectAll')}
                </Button>
              ) : null}
            </header>

            {copies.length === 0 ? (
              <p className="text-faint text-[0.75rem]">{t('sync.emptyRemoteHint')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {copies.map((copy) => {
                  const match = cloud.items.find((item) => item.key === copy.key)
                  const name = copy.label || copy.name
                  return (
                    <li key={copy.remoteId}>
                      <RemoteItemRow
                        item={copy}
                        localName={match?.label}
                        selected={downloads.has(copy.remoteId)}
                        onSelect={(next) =>
                          setDownloads((previous) => toggled(previous, copy.remoteId, next))
                        }
                        onPreview={() => cloud.restore(copy)}
                        onDelete={() => cloud.remove(copy)}
                        onView={() =>
                          cloud.view(viewOfRemote(copy, cloud.owner, match?.id ?? null))
                        }
                        onCompare={
                          match
                            ? () =>
                                cloud.compare(
                                  compareOf(copy.remoteId, cloud.owner.id, cloud.owner, name),
                                )
                            : undefined
                        }
                        busy={cloud.busy}
                      />
                    </li>
                  )
                })}
              </ul>
            )}

            <div className="flex justify-end">
              <Button
                variant="secondary"
                size="sm"
                disabled={selectedDownloads.length === 0 || cloud.busy}
                onClick={() => {
                  cloud.restoreMany(selectedDownloads)
                  setDownloads(new Set())
                }}
              >
                <CloudDownload className="size-3.5" aria-hidden />
                {t('sync.restoreSelected', { count: selectedDownloads.length })}
              </Button>
            </div>
          </section>
        </div>
      </Reveal>
    </Card>
  )
}
