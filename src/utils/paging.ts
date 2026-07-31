import type { IResultList } from '@c8y/client'

/**
 * The first page of a Cumulocity list result, in any of the shapes a caller
 * naturally has on hand:
 *
 * - an already-awaited {@link IResultList} (`await client.inventory.list(...)`)
 * - the pending `list()` promise itself (`client.inventory.list(...)`)
 * - a thunk that produces it lazily (`() => client.inventory.list(...)`)
 *
 * Only the first page has to be supplied. Every subsequent page is fetched via
 * the result's own `paging.next()`, which re-uses the exact client, auth, and
 * filter that produced the first page — so there is no client to pass and no
 * ambiguity between user, tenant, or microservice clients.
 */
export type PageSource<T>
  = | IResultList<T>
    | Promise<IResultList<T>>
    | (() => IResultList<T> | Promise<IResultList<T>>)

/**
 * Optional safety guards for walking large or unbounded Cumulocity collections.
 */
export interface PagingOptions {
  /**
   * Stop after fetching this many pages. Guards against runaway iteration over
   * unexpectedly large collections. Unlimited when omitted.
   */
  maxPages?: number
  /**
   * Stop once this many items have been produced. The page that crosses the
   * limit is truncated so exactly `maxItems` items are yielded. Unlimited when
   * omitted.
   */
  maxItems?: number
}

async function resolvePageSource<T>(source: PageSource<T>): Promise<IResultList<T>> {
  const first = typeof source === 'function' ? source() : source
  return await first
}

/**
 * Lazily walks a Cumulocity list result page by page, yielding each page's data
 * array. This is the engine behind {@link paginate} and {@link fetchAllPages}.
 *
 * Pages are fetched on demand: the next request is only issued when the consumer
 * asks for the next value. Iteration stops when a page comes back shorter than
 * the requested page size (Cumulocity's signal that there is no more data),
 * when the result carries no paging information, or when a {@link PagingOptions}
 * guard is hit.
 *
 * @param source - The first page (result, promise, or thunk). See {@link PageSource}.
 * @param options - Optional {@link PagingOptions} safety guards.
 * @yields Each page as an array of items.
 * @example
 * // Process one page at a time (e.g. bulk insert per page):
 * for await (const page of paginatePages(client.event.list({ pageSize: 2000 }))) {
 *   await bulkInsert(page)
 * }
 */
export async function * paginatePages<T>(source: PageSource<T>, options: PagingOptions = {}): AsyncGenerator<T[]> {
  const { maxPages, maxItems } = options

  let result = await resolvePageSource(source)
  let pagesSeen = 0
  let itemsSeen = 0

  while (true) {
    pagesSeen++
    let page = result.data ?? []

    // Truncate the page that would cross the maxItems limit.
    if (maxItems != null && page.length > maxItems - itemsSeen) {
      page = page.slice(0, Math.max(0, maxItems - itemsSeen))
    }

    if (page.length > 0) {
      yield page
      itemsSeen += page.length
    }

    // Guards.
    if (maxItems != null && itemsSeen >= maxItems) {
      break
    }
    if (maxPages != null && pagesSeen >= maxPages) {
      break
    }

    const paging = result.paging
    if (!paging) {
      // No paging metadata (single, non-collection response) — nothing more to fetch.
      break
    }

    // A page shorter than the requested size is the last page.
    const fullPage = paging.pageSize ? (result.data?.length ?? 0) >= paging.pageSize : true
    // Cumulocity only exposes a `next` link (parsed into `nextPage`) while more
    // data may exist; its absence is an authoritative stop signal that also
    // guards against issuing a request with an invalid page number.
    const hasNextPage = paging.nextPage != null && paging.nextPage > paging.currentPage

    if (!fullPage || !hasNextPage) {
      break
    }

    result = await paging.next()
  }
}

/**
 * Lazily iterates every item across all pages of a Cumulocity list result,
 * yielding one entry at a time — ideal for streaming large collections with a
 * low memory footprint.
 *
 * Pages are fetched on demand as iteration advances, walking via the result's
 * own `paging.next()` (same client and filter as the first page). Iteration
 * stops when a page comes back shorter than the requested page size.
 *
 * @param source - The first page (result, promise, or thunk). See {@link PageSource}.
 * @param options - Optional {@link PagingOptions} safety guards.
 * @yields Each item, in order, across all pages.
 * @example
 * // Stream every active alarm, one at a time:
 * for await (const alarm of paginate(() => client.alarm.list({ pageSize: 2000, status: 'ACTIVE' }))) {
 *   await handleAlarm(alarm)
 * }
 */
export async function * paginate<T>(source: PageSource<T>, options?: PagingOptions): AsyncGenerator<T> {
  for await (const page of paginatePages(source, options)) {
    yield* page
  }
}

/**
 * Collects every item across all pages of a Cumulocity list result into a single
 * array, awaiting until all pages have been fetched.
 *
 * Walks via the result's own `paging.next()` (same client and filter as the
 * first page), stopping when a page comes back shorter than the requested page
 * size. For very large collections prefer {@link paginate} to avoid holding
 * every item in memory at once, or cap the result with
 * {@link PagingOptions.maxItems}.
 *
 * @param source - The first page (result, promise, or thunk). See {@link PageSource}.
 * @param options - Optional {@link PagingOptions} safety guards.
 * @returns All items across all pages, in order.
 * @example
 * // Fetch every managed object matching a fragment:
 * const client = useUserClient(event)
 * const all = await fetchAllPages(client.inventory.list({ pageSize: 2000, fragmentType: 'c8y_Sensor' }))
 */
export async function fetchAllPages<T>(source: PageSource<T>, options?: PagingOptions): Promise<T[]> {
  const all: T[] = []
  for await (const page of paginatePages(source, options)) {
    all.push(...page)
  }
  return all
}
