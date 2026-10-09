/**
 * Ordered product-tour steps. Each page step names the route to open before its target is
 * sought; nav steps stay on the rail (always mounted) and use `advanceOnClick` so a real click
 * both navigates and moves the tour on.
 */
export type TourStepDef = {
  id: string
  /** Route to open when this step becomes active (hash router path). */
  route?: string
  element: string
  titleKey: string
  descriptionKey: string
  /** Clicking the highlight advances (and runs the control's own handler). */
  advanceOnClick?: boolean
  /** Visual spotlight only — Next/Back move the tour. */
  disableActiveInteraction?: boolean
}

export const TOUR_STEPS: TourStepDef[] = [
  {
    id: 'nav-home',
    route: '/',
    element: '[data-tour="nav-home"]',
    titleKey: 'tour.steps.home.title',
    descriptionKey: 'tour.steps.home.body',
    advanceOnClick: true,
  },
  {
    id: 'home-scan',
    route: '/',
    element: '[data-tour="home-scan"]',
    titleKey: 'tour.steps.homeScan.title',
    descriptionKey: 'tour.steps.homeScan.body',
    advanceOnClick: true,
  },
  {
    id: 'nav-agents',
    route: '/agents',
    element: '[data-tour="nav-agents"]',
    titleKey: 'tour.steps.agents.title',
    descriptionKey: 'tour.steps.agents.body',
    advanceOnClick: true,
  },
  {
    id: 'agents-rescan',
    route: '/agents',
    element: '[data-tour="agents-rescan"]',
    titleKey: 'tour.steps.agentsRescan.title',
    descriptionKey: 'tour.steps.agentsRescan.body',
    advanceOnClick: true,
  },
  {
    id: 'nav-projects',
    route: '/projects',
    element: '[data-tour="nav-projects"]',
    titleKey: 'tour.steps.projects.title',
    descriptionKey: 'tour.steps.projects.body',
    advanceOnClick: true,
  },
  {
    id: 'projects-add-folder',
    route: '/projects',
    element: '[data-tour="projects-add-folder"]',
    titleKey: 'tour.steps.projectsAdd.title',
    descriptionKey: 'tour.steps.projectsAdd.body',
    disableActiveInteraction: true,
  },
  {
    id: 'nav-library',
    route: '/library',
    element: '[data-tour="nav-library"]',
    titleKey: 'tour.steps.library.title',
    descriptionKey: 'tour.steps.library.body',
    advanceOnClick: true,
  },
  {
    id: 'library-toolbar',
    route: '/library',
    element: '[data-tour="library-toolbar"]',
    titleKey: 'tour.steps.libraryBrowse.title',
    descriptionKey: 'tour.steps.libraryBrowse.body',
    disableActiveInteraction: true,
  },
  {
    id: 'nav-hub',
    route: '/hub',
    element: '[data-tour="nav-hub"]',
    titleKey: 'tour.steps.hub.title',
    descriptionKey: 'tour.steps.hub.body',
    advanceOnClick: true,
  },
  {
    id: 'hub-toolbar',
    route: '/hub',
    element: '[data-tour="hub-toolbar"]',
    titleKey: 'tour.steps.hubBrowse.title',
    descriptionKey: 'tour.steps.hubBrowse.body',
    disableActiveInteraction: true,
  },
  {
    id: 'nav-settings',
    route: '/settings/about',
    element: '[data-tour="nav-settings"]',
    titleKey: 'tour.steps.settings.title',
    descriptionKey: 'tour.steps.settings.body',
    advanceOnClick: true,
  },
  {
    id: 'settings-tour',
    route: '/settings/about',
    element: '[data-tour="settings-tour"]',
    titleKey: 'tour.steps.settingsReplay.title',
    descriptionKey: 'tour.steps.settingsReplay.body',
    disableActiveInteraction: true,
  },
  {
    id: 'nav-terminal',
    element: '[data-tour="nav-terminal"]',
    titleKey: 'tour.steps.terminal.title',
    descriptionKey: 'tour.steps.terminal.body',
    advanceOnClick: true,
  },
]
