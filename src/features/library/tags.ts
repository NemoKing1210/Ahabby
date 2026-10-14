import type { Skill } from '@/shared/bindings/Skill'

/**
 * The tags the listed skills carry, each once, most-used first — what the filter row offers.
 *
 * A tag is whatever a skill's own `SKILL.md` declares (`Skill.tags`, read by the backend), so the
 * vocabulary is a view of this machine's library rather than a fixed list: a machine with no tagged
 * skills offers nothing, and a tag two agents both use is one chip. The spelling of the first skill
 * that declares a tag wins, because the backend already treats `Design` and `design` as one tag.
 *
 * Ordering by how many skills carry a tag puts the vocabulary that describes this library on the
 * first line of the row; the rest is one fold away.
 */
export function tagVocabulary(skills: Skill[]): string[] {
  const counts = new Map<string, { tag: string; count: number }>()
  for (const skill of skills) {
    for (const tag of skill.tags) {
      const key = tag.toLowerCase()
      const known = counts.get(key)
      if (known) known.count += 1
      else counts.set(key, { tag, count: 1 })
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .map((known) => known.tag)
}

/**
 * `true` when a skill answers a tag filter: nothing selected keeps everything, and several selected
 * keep a skill carrying *any* of them.
 *
 * That is the Hub's own rule for several tags at once (`domain::tags_match`), so the two screens
 * answer the same question the same way. The comparison ignores case, like the backend's.
 */
export function matchesTags(tags: string[], selected: string[]): boolean {
  // A selection of nothing but blanks asks for nothing, exactly as the backend reads it.
  const wanted = selected.map((tag) => tag.trim()).filter((tag) => tag.length > 0)
  if (wanted.length === 0) return true
  return wanted.some((wanted) => tags.some((tag) => tag.toLowerCase() === wanted.toLowerCase()))
}
