import { useState } from 'react'
import { ArrowLeft, Save, Undo2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useOutlet } from 'react-router-dom'

import type { Settings } from '@/shared/bindings/Settings'
import { softTransition, useSoftSlide } from '@/shared/lib/motion'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SkeletonList } from '@/shared/ui/Primitives'
import { toast, toastAppError } from '@/shared/ui/Toast'

import { useSaveSettings, useSettings } from '../api/hooks'
import { LiveAppearance } from '../components/LiveAppearance'
import { SettingsDraftProvider } from '../lib/draft'

/** Cross-fades sections; the layout around it (and the draft it owns) never remounts. */
function SettingsOutlet() {
  const outlet = useOutlet()
  const location = useLocation()
  const slide = useSoftSlide(8)

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.pathname}
        initial={slide.initial}
        animate={slide.animate}
        exit={slide.exit}
        transition={softTransition}
      >
        {outlet}
      </motion.div>
    </AnimatePresence>
  )
}

/**
 * Settings shell: one settings document, one Save button, one preview. The index (`/settings`)
 * and the areas under it are the only screens it draws — the areas are reached from the index
 * and left through the one way back, so no navigation of its own sits beside the content.
 */
export function SettingsLayout() {
  const { t } = useTranslation()
  const location = useLocation()
  const { data: settings, isLoading } = useSettings()
  const save = useSaveSettings()
  const [override, setOverride] = useState<Partial<Settings> | null>(null)

  if (isLoading || !settings) return <SkeletonList rows={4} />

  const overview = location.pathname === '/settings'
  const draft: Settings = { ...settings, ...override }
  const dirty = override !== null
  const update = (patch: Partial<Settings>) =>
    setOverride((prev) => ({ ...(prev ?? {}), ...patch }))

  const onSave = () =>
    save.mutate(draft, {
      onSuccess: () => {
        setOverride(null)
        toast.success(t('settings.saved'))
      },
      onError: (error) => toastAppError(error),
    })

  return (
    <SettingsDraftProvider value={{ draft, update }}>
      <div className="flex flex-col gap-6">
        <PageHeader className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            {overview ? null : (
              <Button variant="ghost" size="sm" className="-ml-3 w-fit" asChild>
                <Link to="/settings">
                  <ArrowLeft className="size-3.5" aria-hidden />
                  {t('settings.back')}
                </Link>
              </Button>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl">{t('settings.title')}</h1>
              {dirty ? <Badge tone="warning">{t('settings.unsaved')}</Badge> : null}
            </div>
            {overview ? (
              <p className="text-muted max-w-prose text-[0.8125rem]">{t('settings.subtitle')}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {dirty ? (
              <Button variant="ghost" onClick={() => setOverride(null)}>
                <Undo2 className="size-3.5" aria-hidden />
                {t('common.discard')}
              </Button>
            ) : null}
            <Button variant="primary" disabled={!dirty} onClick={onSave} loading={save.isPending}>
              {save.isPending ? null : <Save className="size-3.5" aria-hidden />}
              {t('common.save')}
            </Button>
          </div>
        </PageHeader>

        <SettingsOutlet />
      </div>

      <LiveAppearance draft={draft} saved={settings} />
    </SettingsDraftProvider>
  )
}
