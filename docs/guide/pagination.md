# Paging

Cumulocity REST collections (inventory, alarms, events, measurements, audits, users…) are **paged**: a single `list()` call returns one chunk of data plus paging metadata. Walking every page by hand — tracking `currentPage`, re-issuing the request, knowing when to stop — is repetitive and easy to get wrong.

`c8y-nitro` ships three helpers that do it for you:

| Helper                         | Use It When You Want…                             |
| ------------------------------ | ------------------------------------------------- |
| `fetchAllPages(source, opts?)` | …a single array of everything, awaited until done |
| `paginate(source, opts?)`      | …to stream items one at a time (`for await`)      |
| `paginatePages(source, opts?)` | …to process whole pages at a time (batching)      |

All three are pure client helpers — they take **no** `H3Event`/`ServerRequest` and are not tied to request context.

## How termination works

There is no cheap total-count in Cumulocity, so these helpers use the standard idiom: **keep fetching pages until a page comes back shorter than the requested page size.** A short page means there is no more data. (If a collection is an exact multiple of the page size, this costs one extra request that returns an empty page, then stops — unavoidable without the expensive `withTotalPages` flag.)

## You never pass a client

The `source` argument is only the **first page**. Every page after that is fetched via the result's own `paging.next()`, which internally holds the service — and therefore the client, auth, and original filter — that produced the first page. So iteration automatically reuses whichever client you started with (user, tenant, or microservice), and there is nothing to pass or reconcile.

`source` can be any of:

```ts
fetchAllPages(client.inventory.list({ pageSize: 2000 })) // the pending promise
fetchAllPages(await client.inventory.list({ pageSize: 2000 })) // an already-awaited result
fetchAllPages(() => client.inventory.list({ pageSize: 2000 })) // a thunk (fetched lazily)
```

The thunk form is handy with `paginate`/`paginatePages`: no request is issued until iteration actually begins.

::: tip Set your query once
Whatever filter you pass to the first `list()` call — `pageSize`, `query`, `fragmentType`, `withTotalPages: false`, … — is reused for every subsequent page automatically. Set it once, on the first call. Cumulocity's max page size is `2000`; use it to minimise round-trips.
:::

## Collect everything

```ts
import { fetchAllPages, useUserClient } from 'c8y-nitro/utils'
import { defineEventHandler } from 'nitro/h3'

export default defineEventHandler(async (event) => {
  const client = useUserClient(event)

  const sensors = await fetchAllPages(
    client.inventory.list({ pageSize: 2000, fragmentType: 'c8y_Sensor' }),
  )

  return { count: sensors.length, sensors }
})
```

## Stream item by item

For large collections, prefer `paginate` so you never hold everything in memory at once:

```ts
import { paginate, useDeployedTenantClient } from 'c8y-nitro/utils'

const client = await useDeployedTenantClient()

for await (const alarm of paginate(() => client.alarm.list({ pageSize: 2000, status: 'ACTIVE' }))) {
  await handleAlarm(alarm) // fetched lazily, one page at a time
}
```

## Process page by page

When work is naturally batched (bulk insert, chunked export), iterate whole pages:

```ts
import { paginatePages } from 'c8y-nitro/utils'

for await (const page of paginatePages(client.event.list({ pageSize: 2000 }))) {
  await bulkInsert(page) // page is the full T[] for that chunk
}
```

## Safety guards

For unbounded or very large collections, cap the walk with `maxPages` and/or `maxItems`:

```ts
// At most 10k items, and never more than 50 requests:
const recent = await fetchAllPages(client.measurement.list({ pageSize: 2000 }), {
  maxPages: 50,
  maxItems: 10_000,
})
```

`maxItems` truncates the page that crosses the limit, so you get back exactly `maxItems` items and no further request is issued.

## Works with any client

Because the client is carried by the result, the same helper works regardless of which client made the first call:

```ts
const forUser = await fetchAllPages(useUserClient(event).inventory.list({ pageSize: 2000 }))
const forTenant = await fetchAllPages((await useUserTenantClient(event)).inventory.list({ pageSize: 2000 }))
```

See the [Utilities reference](/reference/utilities#paging) for the full signatures.
