import { describe, expect, it } from 'vitest'

import { routeForStep } from './runTour'
import { TOUR_STEPS } from './steps'

describe('routeForStep', () => {
  it('returns the route the next page step needs before waitForElement runs', () => {
    const projectsAdd = TOUR_STEPS.findIndex((step) => step.id === 'projects-add-folder')
    const navLibrary = TOUR_STEPS.findIndex((step) => step.id === 'nav-library')
    const libraryToolbar = TOUR_STEPS.findIndex((step) => step.id === 'library-toolbar')

    expect(projectsAdd).toBeGreaterThanOrEqual(0)
    expect(routeForStep(navLibrary)).toBe('/library')
    expect(routeForStep(libraryToolbar)).toBe('/library')
    // Next from "Add folder" must already know Library's route — that is what onNextClick opens
    // before moveNext, so waitForElement does not time out on the Projects screen.
    expect(routeForStep(projectsAdd + 1)).toBe('/library')
  })

  it('gives every nav step a route so Next alone can change screens', () => {
    const navSteps = TOUR_STEPS.filter(
      (step) => step.id.startsWith('nav-') && step.id !== 'nav-terminal',
    )
    expect(navSteps.length).toBeGreaterThan(0)
    for (const step of navSteps) {
      expect(step.route, step.id).toBeTruthy()
    }
  })
})
