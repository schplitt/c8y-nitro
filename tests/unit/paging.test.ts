import type { IResultList } from '@c8y/client'
import { describe, expect, it } from 'vitest'
import { fetchAllPages, paginate, paginatePages } from '../../src/utils/paging'

/**
 * Builds a fake Cumulocity list source that mirrors \@c8y/client paging:
 * - `list()` returns a page slice plus a `paging` object
 * - `paging.next()` re-issues through the same source (as the real client does)
 * - a `next` link (→ `nextPage`) is present exactly when the page is full,
 * matching Cumulocity's behaviour without `withTotalPages`
 * It also records how many list requests were issued so tests can assert that
 * iteration never over-fetches.
 * @param items - The full backing collection to page over.
 * @param pageSize - The page size echoed in each result's paging metadata.
 * @param opts - Source behaviour overrides.
 * @param opts.withStatistics - When false, results carry no paging metadata (single-page response).
 */
function makePagedSource<T>(items: T[], pageSize: number, opts: { withStatistics?: boolean } = {}) {
  const { withStatistics = true } = opts
  let listCalls = 0

  function listPage(currentPage: number): IResultList<T> {
    listCalls++
    const start = (currentPage - 1) * pageSize
    const data = items.slice(start, start + pageSize)

    const paging = withStatistics
      ? {
          pageSize,
          currentPage,
          nextPage: data.length === pageSize ? currentPage + 1 : null,
          prevPage: currentPage > 1 ? currentPage - 1 : null,
          totalPages: undefined,
          totalElements: undefined,
          next: () => Promise.resolve(listPage(currentPage + 1)),
          prev: () => Promise.resolve(listPage(currentPage - 1)),
          list: () => Promise.resolve(listPage(currentPage)),
          goto: (page: number) => Promise.resolve(listPage(page)),
        }
      : undefined

    return { data, res: {}, paging } as unknown as IResultList<T>
  }

  return {
    firstResult: () => listPage(1),
    firstThunk: () => () => listPage(1),
    calls: () => listCalls,
  }
}

const nums = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

describe('fetchAllPages', () => {
  it('collects every item across pages in order', async () => {
    const src = makePagedSource(nums(5), 2)
    const all = await fetchAllPages(src.firstResult())
    expect(all).toEqual([1, 2, 3, 4, 5])
  })

  it('stops on a short final page without an extra request', async () => {
    // 5 items, pageSize 2 → pages of [2, 2, 1]; the short 3rd page ends it.
    const src = makePagedSource(nums(5), 2)
    const all = await fetchAllPages(src.firstResult())
    expect(all).toHaveLength(5)
    expect(src.calls()).toBe(3)
  })

  it('handles a collection that is an exact multiple of the page size', async () => {
    // 4 items, pageSize 2 → [2, 2] then one empty trailing fetch to confirm the end.
    const src = makePagedSource(nums(4), 2)
    const all = await fetchAllPages(src.firstResult())
    expect(all).toEqual([1, 2, 3, 4])
    expect(src.calls()).toBe(3)
  })

  it('returns a single short page with no extra request', async () => {
    const src = makePagedSource(nums(1), 2)
    const all = await fetchAllPages(src.firstResult())
    expect(all).toEqual([1])
    expect(src.calls()).toBe(1)
  })

  it('returns the only page when the result carries no paging metadata', async () => {
    const src = makePagedSource(nums(3), 2, { withStatistics: false })
    const all = await fetchAllPages(src.firstResult())
    expect(all).toEqual([1, 2])
    expect(src.calls()).toBe(1)
  })

  it('accepts a result, a promise, and a thunk equivalently', async () => {
    const fromResult = await fetchAllPages(makePagedSource(nums(5), 2).firstResult())
    const fromPromise = await fetchAllPages(Promise.resolve(makePagedSource(nums(5), 2).firstResult()))
    const fromThunk = await fetchAllPages(makePagedSource(nums(5), 2).firstThunk())
    expect(fromResult).toEqual([1, 2, 3, 4, 5])
    expect(fromPromise).toEqual([1, 2, 3, 4, 5])
    expect(fromThunk).toEqual([1, 2, 3, 4, 5])
  })
})

describe('paging guards', () => {
  it('stops after maxPages without fetching further', async () => {
    const src = makePagedSource(nums(10), 2)
    const all = await fetchAllPages(src.firstResult(), { maxPages: 2 })
    expect(all).toEqual([1, 2, 3, 4])
    expect(src.calls()).toBe(2)
  })

  it('truncates the crossing page at maxItems and does not over-fetch', async () => {
    const src = makePagedSource(nums(10), 2)
    const all = await fetchAllPages(src.firstResult(), { maxItems: 3 })
    expect(all).toEqual([1, 2, 3])
    expect(src.calls()).toBe(2)
  })
})

describe('paginate', () => {
  it('yields each entry in order across pages', async () => {
    const src = makePagedSource(nums(5), 2)
    const seen: number[] = []
    for await (const item of paginate(src.firstResult())) {
      seen.push(item)
    }
    expect(seen).toEqual([1, 2, 3, 4, 5])
  })

  it('is lazy — it issues no request until iteration begins', async () => {
    const src = makePagedSource(nums(5), 2)
    const iterator = paginate(src.firstThunk())
    expect(src.calls()).toBe(0)
    await iterator.next()
    expect(src.calls()).toBe(1)
  })

  it('honours maxItems', async () => {
    const src = makePagedSource(nums(10), 2)
    const seen: number[] = []
    for await (const item of paginate(src.firstResult(), { maxItems: 3 })) {
      seen.push(item)
    }
    expect(seen).toEqual([1, 2, 3])
  })
})

describe('paginatePages', () => {
  it('yields whole pages honouring page boundaries', async () => {
    const src = makePagedSource(nums(5), 2)
    const pages: number[][] = []
    for await (const page of paginatePages(src.firstResult())) {
      pages.push(page)
    }
    expect(pages).toEqual([[1, 2], [3, 4], [5]])
  })
})
