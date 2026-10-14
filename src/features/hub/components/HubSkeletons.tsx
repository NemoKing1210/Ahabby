import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Card } from '@/shared/ui/Card'
import { Skeleton } from '@/shared/ui/Primitives'

/**
 * One entry while the collection it comes from is being read.
 *
 * The placeholder is the card's own row — the icon tile, the title line with its badge, two lines
 * of description, the tag chips and the trailing action — because a source is a real request to a
 * real collection and the answer can take a moment: showing the shape of what is coming keeps the
 * screen steady when it lands instead of jumping from a spinner to a list of a different height.
 */
export function HubEntrySkeleton() {
  return (
    <Card className="p-4" aria-hidden>
      <div className="flex items-start gap-3">
        <Skeleton className="size-9 shrink-0 rounded-lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-4 w-40 max-w-[45%]" />
            <Skeleton className="h-4 w-12 rounded-full" />
          </div>
          <Skeleton className="h-3 w-full max-w-lg" />
          <Skeleton className="h-3 w-2/3 max-w-sm" />
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <Skeleton className="h-4 w-16 rounded-full" />
            <Skeleton className="h-4 w-11 rounded-full" />
            <Skeleton className="h-4 w-20 rounded-full" />
          </div>
        </div>
        <Skeleton className="h-7 w-20 shrink-0 rounded-lg" />
      </div>
    </Card>
  )
}

/**
 * Placeholder rows for one collection, easing in one after another while it is read.
 *
 * The stagger is `AnimatedList`'s own entrance, the one the real cards get, so a slow source reads
 * as a list filling rather than as a frozen screen. `aria-busy` is what says the list is not ready:
 * the rows themselves carry no text a reader could announce.
 */
export function HubEntrySkeletons({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true">
      <AnimatedList>
        {Array.from({ length: rows }, (_, index) => (
          <HubEntrySkeleton key={index} />
        ))}
      </AnimatedList>
    </div>
  )
}

/**
 * The page itself, while the list of collections is being read.
 *
 * The Hub's first request is the source files, and until it answers there is no collection to read
 * at all: this is the page's own shape — the heading, the search box and the filters, the two
 * collections a first answer usually holds — so the whole screen does not move when the sources
 * arrive.
 */
export function HubCatalogSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-3.5 w-80 max-w-full" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-10 min-w-64 flex-1 rounded-lg" />
        <Skeleton className="h-10 w-32 rounded-lg" />
        <Skeleton className="h-10 w-28 rounded-lg" />
      </div>
      {[0, 1].map((section) => (
        <div key={section} className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Skeleton className="size-7 rounded-lg" />
            <Skeleton className="h-4 w-44" />
          </div>
          <HubEntrySkeletons rows={3} />
        </div>
      ))}
    </div>
  )
}
