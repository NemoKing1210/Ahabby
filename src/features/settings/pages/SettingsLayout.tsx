import { useState } from 'react'
import {
  AppWindow,
  EyeOff,
  Globe,
  Info,
  Palette,
  Save,
  Search,
  ShieldCheck,
  Terminal as TerminalIcon,
  Undo2,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { NavLink, useLocation, useOutlet } from 'react-router-dom'

import type { Settings } from '@/shared/bindings/Settings'
import { cn } from '@/shared/lib/cn'
import { glideTransition, softTransition, useSoftSlide } from '@/shared/lib/motion'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SkeletonList } from '@/shared/ui/Primitives'
import { toast, toastAppError } from '@/shared/ui/Toast'

import { useSaveSettings, useSettings } from '../api/hooks'
import { LiveAppearance } from '../components/LiveAppearance'
import { SettingsDraftProvider } from '../lib/draft'

/**
 * Every settings area, in the order they are shown. Each entry is a route of its own (`/settings/
 * <to>`), so a section can be linked to and the browser's back button works between them.
 */
const SECTIONS = [
  { to: 'appearance', labelKey: 'settings.appearance', icon: Palette },
  { to: 'window', labelKey: 'settings.windowAndTray', icon: AppWindow },
  { to: 'terminal', labelKey: 'settings.terminal', icon: TerminalIcon },
  { to: 'search', labelKey: 'settings.searchAndCatalog', icon: Search },
  { to: 'network', labelKey: 'settings.network', icon: Globe },
  { to: 'safety', labelKey: 'settings.safety', icon: ShieldCheck },
  { to: 'hidden', labelKey: 'settings.hiddenAgents', icon: EyeOff },
  { to: 'about', labelKey: 'settings.about', icon: Info },
] as const

/** The sub-navigation: a rail beside the content on a wide window, a scrollable row on a narrow one. */
function SectionNav() {
  const { t } = useTranslation()

  return (
    <nav
      aria-label={t('settings.sectionsLabel')}
      className="flex gap-1 overflow-x-auto pb-1 lg:sticky lg:top-20 lg:w-56 lg:shrink-0 lg:flex-col lg:self-start lg:overflow-visible lg:pb-0"
    >
      {SECTIONS.map((section) => (
        <NavLink
          key={section.to}
          to={section.to}
          className={({ isActive }) =>
            cn(
              'ease-warm relative flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-[0.875rem] font-medium transition-colors duration-150',
              isActive
                ? 'text-accent-strong'
                : 'text-muted hover:bg-surface-2 hover:text-foreground',
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive ? (
                <motion.span
                  aria-hidden
                  layoutId="settings-section-pill"
                  transition={glideTransition}
                  className="bg-accent-soft absolute inset-0 rounded-xl"
                />
              ) : null}
              <section.icon className="relative size-4 shrink-0" aria-hidden />
              <span className="relative truncate">{t(section.labelKey)}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

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
 * Settings shell: one settings document, one Save button, one preview. Subpages only render the
 * fields of their own section and read the draft from context.
 */
export function SettingsLayout() {
  const { t } = useTranslation()
  const { data: settings, isLoading } = useSettings()
  const save = useSaveSettings()
  const [override, setOverride] = useState<Partial<Settings> | null>(null)

  if (isLoading || !settings) return <SkeletonList rows={4} />

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
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl">{t('settings.title')}</h1>
              {dirty ? <Badge tone="warning">{t('settings.unsaved')}</Badge> : null}
            </div>
            <p className="text-muted max-w-prose text-[0.8125rem]">{t('settings.subtitle')}</p>
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

        <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
          <SectionNav />
          <div className="min-w-0 flex-1">
            <SettingsOutlet />
          </div>
        </div>
      </div>

      <LiveAppearance draft={draft} saved={settings} />
    </SettingsDraftProvider>
  )
}
