/**
 * Curated Hub skill recommendations by developer role.
 *
 * Each pick points at a real hub entry id (`<sourceId>/<skillDir>`). The list is editorial —
 * drawn from Anthropic, Vercel, Superpowers, Sentry, Trail of Bits, Cloudflare, Expo and the
 * other collections Ahabby ships — not from a live ranking API.
 */

export type RecommendationRoleId =
  | 'everyday'
  | 'frontend'
  | 'backend'
  | 'fullstack'
  | 'mobile'
  | 'devops'
  | 'security'
  | 'qa'
  | 'data'
  | 'docs'
  | 'agents'

export interface RecommendationPick {
  /** Stable id for i18n (`hub.recommendations.picks.<id>.*`). */
  id: string
  /** Hub entry id — `<sourceId>/<repository path of the skill>`. */
  entryId: string
}

export interface RecommendationRole {
  id: RecommendationRoleId
  picks: RecommendationPick[]
}

/** Roles in the order the picker shows them. */
export const RECOMMENDATION_ROLES: RecommendationRole[] = [
  {
    id: 'everyday',
    picks: [
      { id: 'brainstorming', entryId: 'obra-superpowers/skills/brainstorming' },
      { id: 'writing-plans', entryId: 'obra-superpowers/skills/writing-plans' },
      { id: 'tdd', entryId: 'obra-superpowers/skills/test-driven-development' },
      { id: 'debugging', entryId: 'obra-superpowers/skills/systematic-debugging' },
      { id: 'verification', entryId: 'obra-superpowers/skills/verification-before-completion' },
      { id: 'code-review', entryId: 'sentry-skills/skills/code-review' },
      { id: 'commit', entryId: 'sentry-skills/skills/commit' },
      { id: 'find-bugs', entryId: 'sentry-skills/skills/find-bugs' },
    ],
  },
  {
    id: 'frontend',
    picks: [
      { id: 'frontend-design', entryId: 'anthropic-skills/skills/frontend-design' },
      { id: 'react-best-practices', entryId: 'vercel-skills/skills/react-best-practices' },
      { id: 'web-design-guidelines', entryId: 'vercel-skills/skills/web-design-guidelines' },
      { id: 'composition-patterns', entryId: 'vercel-skills/skills/composition-patterns' },
      { id: 'webapp-testing', entryId: 'anthropic-skills/skills/webapp-testing' },
      { id: 'antislop-ui', entryId: 'anti-slop/skills/antislop-ui' },
      { id: 'web-perf', entryId: 'cloudflare-skills/skills/web-perf' },
      { id: 'triage-frontend', entryId: 'sentry-skills/skills/triage-frontend-issues' },
    ],
  },
  {
    id: 'backend',
    picks: [
      {
        id: 'api-design',
        entryId: 'wshobson-agents/plugins/backend-development/skills/api-design-principles',
      },
      {
        id: 'architecture',
        entryId: 'wshobson-agents/plugins/backend-development/skills/architecture-patterns',
      },
      {
        id: 'fastapi',
        entryId: 'wshobson-agents/plugins/api-scaffolding/skills/fastapi-templates',
      },
      {
        id: 'nodejs-backend',
        entryId: 'wshobson-agents/plugins/javascript-typescript/skills/nodejs-backend-patterns',
      },
      { id: 'document-api', entryId: 'sentry-skills/skills/document-api-endpoint' },
      { id: 'security-review', entryId: 'sentry-skills/skills/security-review' },
      { id: 'find-bugs-be', entryId: 'sentry-skills/skills/find-bugs' },
      { id: 'workers-bp', entryId: 'cloudflare-skills/skills/workers-best-practices' },
    ],
  },
  {
    id: 'fullstack',
    picks: [
      { id: 'frontend-design-fs', entryId: 'anthropic-skills/skills/frontend-design' },
      { id: 'react-bp-fs', entryId: 'vercel-skills/skills/react-best-practices' },
      { id: 'webapp-testing-fs', entryId: 'anthropic-skills/skills/webapp-testing' },
      { id: 'deploy-vercel', entryId: 'vercel-skills/skills/deploy-to-vercel' },
      { id: 'security-review-fs', entryId: 'sentry-skills/skills/security-review' },
      { id: 'writing-plans-fs', entryId: 'obra-superpowers/skills/writing-plans' },
      { id: 'tdd-fs', entryId: 'obra-superpowers/skills/test-driven-development' },
      { id: 'pr-writer', entryId: 'sentry-skills/skills/pr-writer' },
    ],
  },
  {
    id: 'mobile',
    picks: [
      { id: 'expo-overview', entryId: 'expo-skills/plugins/expo/skills/expo-overview' },
      {
        id: 'expo-structure',
        entryId: 'expo-skills/plugins/expo/skills/expo-project-structure',
      },
      { id: 'expo-router', entryId: 'expo-skills/plugins/expo/skills/expo-router' },
      { id: 'expo-ui', entryId: 'expo-skills/plugins/expo/skills/expo-ui' },
      { id: 'react-native', entryId: 'vercel-skills/skills/react-native-skills' },
      { id: 'eas-update', entryId: 'expo-skills/plugins/expo/skills/eas-update' },
      { id: 'antislop-mobile', entryId: 'anti-slop/skills/antislop-layoutmobile' },
    ],
  },
  {
    id: 'devops',
    picks: [
      { id: 'wrangler', entryId: 'cloudflare-skills/skills/wrangler' },
      { id: 'cloudflare', entryId: 'cloudflare-skills/skills/cloudflare' },
      { id: 'workers-bp-ops', entryId: 'cloudflare-skills/skills/workers-best-practices' },
      { id: 'deploy-vercel-ops', entryId: 'vercel-skills/skills/deploy-to-vercel' },
      { id: 'vercel-optimize', entryId: 'vercel-skills/skills/vercel-optimize' },
      { id: 'gha-security', entryId: 'sentry-skills/skills/gha-security-review' },
      {
        id: 'github-actions',
        entryId: 'wshobson-agents/plugins/cicd-automation/skills/github-actions-templates',
      },
      {
        id: 'deployment-pipeline',
        entryId: 'wshobson-agents/plugins/cicd-automation/skills/deployment-pipeline-design',
      },
    ],
  },
  {
    id: 'security',
    picks: [
      { id: 'security-review-sec', entryId: 'sentry-skills/skills/security-review' },
      {
        id: 'semgrep',
        entryId: 'trailofbits-skills/plugins/static-analysis/skills/semgrep',
      },
      {
        id: 'codeql',
        entryId: 'trailofbits-skills/plugins/static-analysis/skills/codeql',
      },
      {
        id: 'diff-review',
        entryId: 'trailofbits-skills/plugins/differential-review/skills/differential-review',
      },
      { id: 'secret-serialization', entryId: 'sentry-skills/skills/secret-serialization' },
      { id: 'skill-scanner', entryId: 'sentry-skills/skills/skill-scanner' },
      { id: 'gha-security-sec', entryId: 'sentry-skills/skills/gha-security-review' },
    ],
  },
  {
    id: 'qa',
    picks: [
      { id: 'webapp-testing-qa', entryId: 'anthropic-skills/skills/webapp-testing' },
      { id: 'tdd-qa', entryId: 'obra-superpowers/skills/test-driven-development' },
      { id: 'verification-qa', entryId: 'obra-superpowers/skills/verification-before-completion' },
      { id: 'find-bugs-qa', entryId: 'sentry-skills/skills/find-bugs' },
      { id: 'code-review-qa', entryId: 'sentry-skills/skills/code-review' },
      {
        id: 'js-testing',
        entryId: 'wshobson-agents/plugins/javascript-typescript/skills/javascript-testing-patterns',
      },
    ],
  },
  {
    id: 'data',
    picks: [
      { id: 'xlsx', entryId: 'anthropic-skills/skills/xlsx' },
      { id: 'pdf', entryId: 'anthropic-skills/skills/pdf' },
      {
        id: 'postgresql',
        entryId: 'wshobson-agents/plugins/database-design/skills/postgresql-table-design',
      },
      {
        id: 'dbt',
        entryId: 'wshobson-agents/plugins/data-engineering/skills/dbt-transformation-patterns',
      },
      {
        id: 'data-quality',
        entryId: 'wshobson-agents/plugins/data-engineering/skills/data-quality-frameworks',
      },
      { id: 'docx', entryId: 'anthropic-skills/skills/docx' },
    ],
  },
  {
    id: 'docs',
    picks: [
      { id: 'docx-docs', entryId: 'anthropic-skills/skills/docx' },
      { id: 'pptx', entryId: 'anthropic-skills/skills/pptx' },
      { id: 'pdf-docs', entryId: 'anthropic-skills/skills/pdf' },
      { id: 'doc-coauthoring', entryId: 'anthropic-skills/skills/doc-coauthoring' },
      { id: 'writing-guidelines', entryId: 'vercel-skills/skills/writing-guidelines' },
      { id: 'pr-writer-docs', entryId: 'sentry-skills/skills/pr-writer' },
      { id: 'blog-writing', entryId: 'sentry-skills/skills/blog-writing-guide' },
    ],
  },
  {
    id: 'agents',
    picks: [
      { id: 'skill-creator', entryId: 'anthropic-skills/skills/skill-creator' },
      { id: 'mcp-builder', entryId: 'anthropic-skills/skills/mcp-builder' },
      { id: 'writing-skills', entryId: 'obra-superpowers/skills/writing-skills' },
      { id: 'using-superpowers', entryId: 'obra-superpowers/skills/using-superpowers' },
      { id: 'agents-md', entryId: 'sentry-skills/skills/agents-md' },
      { id: 'skill-writer', entryId: 'sentry-skills/skills/skill-writer' },
      { id: 'agents-sdk', entryId: 'cloudflare-skills/skills/agents-sdk' },
    ],
  },
]

export function roleById(id: RecommendationRoleId): RecommendationRole {
  const role = RECOMMENDATION_ROLES.find((candidate) => candidate.id === id)
  return role ?? RECOMMENDATION_ROLES[0]!
}

/** Every entry id a role asks for — used to warm the hub cache. */
export function entryIdsForRole(id: RecommendationRoleId): string[] {
  return roleById(id).picks.map((pick) => pick.entryId)
}

/** Source ids the recommendations catalogue depends on. */
export function recommendationSourceIds(): string[] {
  const ids = new Set<string>()
  for (const role of RECOMMENDATION_ROLES) {
    for (const pick of role.picks) {
      const slash = pick.entryId.indexOf('/')
      if (slash > 0) ids.add(pick.entryId.slice(0, slash))
    }
  }
  return [...ids]
}
