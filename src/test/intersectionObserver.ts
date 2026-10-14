/**
 * An `IntersectionObserver` a test drives by hand: it holds the callback and the targets it was
 * given, so a case can say "the sentinel scrolled into view" and nothing else.
 *
 * It has to exist *before* `shared/lib/lazyRows` is imported — that module decides once, at load,
 * whether this environment can watch a sentinel at all, and jsdom has no observer of its own — so a
 * test file installs it from a `vi.hoisted` callback, which runs above the file's imports (which is
 * also why those files reach this module with a dynamic import: a static one would still be
 * uninitialised inside the hoisted callback).
 */
export class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []

  private readonly targets = new Set<Element>()

  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.push(this)
  }

  observe(target: Element): void {
    this.targets.add(target)
  }

  unobserve(target: Element): void {
    this.targets.delete(target)
  }

  disconnect(): void {
    this.targets.clear()
  }

  /** Reports every target it holds as having come into view. */
  intersect(): void {
    this.callback(
      [...this.targets].map(
        (target) => ({ target, isIntersecting: true }) as unknown as IntersectionObserverEntry,
      ),
      this as unknown as IntersectionObserver,
    )
  }

  /** The observer watching now — every batch re-creates one around the sentinel's new place. */
  static latest(): FakeIntersectionObserver {
    const latest = FakeIntersectionObserver.instances.at(-1)
    if (!latest) throw new Error('no observer was created')
    return latest
  }

  /** Forgets the observers of the case before, so one case's list is not the next one's. */
  static reset(): void {
    FakeIntersectionObserver.instances = []
  }
}

/** Publishes the stub as the environment's observer. */
export function installFakeIntersectionObserver(): void {
  // The stub stands in for a browser class jsdom does not ship; it is the only non-nullable way to
  // say so.
  globalThis.IntersectionObserver =
    FakeIntersectionObserver as unknown as typeof IntersectionObserver
}
