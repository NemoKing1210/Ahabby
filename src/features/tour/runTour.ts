import { driver, type DriveStep, type Driver } from 'driver.js'
import 'driver.js/dist/driver.css'

import './tour.css'

import { TOUR_STEPS } from './steps'

export type StartTourOptions = {
  t: (key: string) => string
  navigate: (to: string) => void
  onDone: () => void
}

/** Route the step at `index` wants open before its target is sought. */
export function routeForStep(index: number): string | undefined {
  return TOUR_STEPS[index]?.route
}

/**
 * Builds a driver.js tour from {@link TOUR_STEPS}, themed for Ahabby. Callers own the returned
 * instance and should destroy any previous one before starting again.
 *
 * Navigation must happen *before* `moveNext` / `movePrevious`: driver.js runs `waitForElement`
 * before `onHighlightStarted`, so a page target is skipped if the route has not changed yet.
 */
export function startProductTour({ t, navigate, onDone }: StartTourOptions): Driver {
  const go = (index: number | undefined) => {
    if (typeof index !== 'number') return
    const route = routeForStep(index)
    if (route) navigate(route)
  }

  const steps: DriveStep[] = TOUR_STEPS.map((def) => ({
    element: def.element,
    waitForElement: 4_000,
    skipMissingElement: true,
    advanceOnClick: def.advanceOnClick ?? false,
    disableActiveInteraction: def.disableActiveInteraction ?? false,
    popover: {
      title: t(def.titleKey),
      description: t(def.descriptionKey),
      side: 'right',
      align: 'start',
    },
  }))

  const instance = driver({
    steps,
    showProgress: true,
    animate: true,
    smoothScroll: true,
    allowClose: true,
    stagePadding: 6,
    stageRadius: 12,
    overlayOpacity: 0.55,
    overlayClickBehavior: 'close',
    popoverClass: 'ahabby-tour',
    nextBtnText: t('tour.next'),
    prevBtnText: t('tour.back'),
    doneBtnText: t('tour.done'),
    progressText: t('tour.progress'),
    // Overrides replace the default button handlers — we navigate first, then advance.
    onNextClick: () => {
      const index = instance.getActiveIndex() ?? 0
      go(index + 1)
      instance.moveNext()
    },
    onPrevClick: () => {
      const index = instance.getActiveIndex() ?? 0
      go(index - 1)
      instance.movePrevious()
    },
    onDoneClick: () => {
      instance.destroy()
    },
    onCloseClick: () => {
      instance.destroy()
    },
    onDestroyed: onDone,
  })

  go(0)
  instance.drive()
  return instance
}
