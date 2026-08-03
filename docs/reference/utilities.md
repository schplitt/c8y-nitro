# Utilities

The runtime utilities are the part of `c8y-nitro` you will use most after the initial module setup.

Import them from `c8y-nitro/utils`.

```ts
import { useUser, useUserClient } from 'c8y-nitro/utils'
```

Most helpers that depend on request context accept either an `H3Event` or `ServerRequest`.

## How To Read This Page

- Start with `Resources` and `Client` if you are writing route handlers.
- Use `Credentials` and `Tenant Options` for cross-tenant or configuration-aware logic.
- Use `Middleware` when you want route-level access control.
- Use `Tasks & Scheduling` when work should happen later instead of inline with a request.

For longer examples, see [Tenant Options](/guide/tenant-options), [Auth Middleware](/guide/auth-middleware), and [Tasks & Scheduling](/guide/scheduled-tasks).

## Credentials

| Function                           | Description                                   | Request Context |
| ---------------------------------- | --------------------------------------------- | :-------------: |
| `useSubscribedTenantCredentials()` | Get credentials for all subscribed tenants    |       ❌        |
| `useDeployedTenantCredentials()`   | Get credentials for the deployed tenant       |       ❌        |
| `useUserTenantCredentials()`       | Get credentials for the current user's tenant |       ✅        |

`useDeployedTenantCredentials()` shares its cache with `useSubscribedTenantCredentials()`. Both support `.invalidate()` and `.refresh()`.

### Tenant Credentials Lifecycle Hook

`c8y-nitro` emits `c8y:tenantCredentialsUpdated` when the subscribed credentials cache is populated for the first time, refreshed with a changed tenant set, or refreshed with changed credentials for an existing tenant (e.g. a service-user password rotation).

```ts
import type { TenantCredentials } from 'c8y-nitro/types'
import { definePlugin } from 'nitro'

export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook('c8y:tenantCredentialsUpdated', (prev, next) => {
    const previousTenants = prev ? Object.keys(prev) : []
    const nextTenants = Object.keys(next)

    console.log({ previousTenants, nextTenants })
  })
})
```

## Tenant Options

| Function             | Description                                   | Request Context |
| -------------------- | --------------------------------------------- | :-------------: |
| `useTenantOption()`  | Handle for a single option (one category+key) |       ❌        |
| `useTenantOptions()` | Handle for a whole settings category          |       ❌        |

Both take a Cumulocity `Client` as the first argument — the client determines which **tenant** is targeted (essential for multi-tenant microservices). Get one from `useDeployedTenantClient()` (owner tenant), `useUserTenantClient(event)` (current request's tenant), or `useSubscribedTenantClients()`.

```ts
import {
  useTenantOption,
  useTenantOptions,
  useDeployedTenantClient,
  useUserTenantClient,
} from 'c8y-nitro/utils'

const client = await useDeployedTenantClient() // or useUserTenantClient(event)

// Single option handle:
const value = await useTenantOption(client, 'myOption').read()
await useTenantOption(client, 'myOption').set('new-value')
const token = await useTenantOption(client, `dynamic.${id}`).getOrInsert('')
await useTenantOption(client, 'myOption').delete()

// Category handle:
const all = await useTenantOptions(client).list()
await useTenantOptions(client).setAll({ a: '1', b: '2' })
await useTenantOptions(client).option('myOption').read()

// Foreign category — pass the key set for autocomplete; credentials.* is a compile error:
await useTenantOptions<'someKey'>(client, 'other-service').option('someKey').read()
```

Manifest-declared keys are suggested via autocomplete but any dynamic string is accepted.

`read()` returns `undefined` for a missing option (404) instead of throwing. `delete()` is idempotent. `set()` is an upsert (create-or-update).

### Cache invalidation

Reads are cached per tenant (`${tenant}::${category}::${key}`). Invalidate at three levels:

```ts
// one option:
await useTenantOption(client, 'myOption').invalidate()
const fresh = await useTenantOption(client, 'myOption').refresh()

// one tenant + category:
await useTenantOptions(client).invalidateAll()
await useTenantOptions(client).refreshAll()

// everything, all tenants and categories:
await useTenantOptions.invalidateAll()
await useTenantOptions.refreshAll()
```

`invalidateAll()` / `refreshAll()` only touch keys already read in the current process.

## Tasks & Scheduling

| Function                           | Description                                                      |
| ---------------------------------- | ---------------------------------------------------------------- |
| `c8yTasks()`                       | Create a type-charged task registry                              |
| `registry.createTask()`            | Register a task (function) under a compile-time name             |
| `registry.run()`                   | Run a task immediately, ad-hoc                                   |
| `registry.scheduleJob()`           | Schedule a named job (once via `{ in }`/`{ at }`, or `{ cron }`) |
| `registry.triggerJob()`            | Run an existing job now, respecting its concurrency              |
| `registry.listJobs()` / `getJob()` | Inspect registered jobs                                          |
| `registry.cancelJob()`             | Cancel a job by name                                             |

Scheduling is runtime-only and self-contained (no Nitro tasks required). See [Tasks & Scheduling](/guide/scheduled-tasks) for the full model, concurrency, and cron details.

## Resources

| Function         | Description                        | Request Context |
| ---------------- | ---------------------------------- | :-------------: |
| `useUser()`      | Fetch current user from Cumulocity |       ✅        |
| `useUserRoles()` | Get roles of the current user      |       ✅        |

These are the usual entry points when your route logic needs to know who is calling it.

## Client

| Function                       | Description                                               | Request Context |
| ------------------------------ | --------------------------------------------------------- | :-------------: |
| `useUserClient()`              | Create a client authenticated with the user's credentials |       ✅        |
| `useUserTenantClient()`        | Create a client for the user's tenant                     |       ✅        |
| `useSubscribedTenantClients()` | Create clients for all subscribed tenants                 |       ❌        |
| `useDeployedTenantClient()`    | Create a client for the deployed tenant                   |       ❌        |

These helpers are useful when you want the raw platform client but do not want to rebuild authentication context resolution by hand.

## Paging

Cumulocity list endpoints are paged. These helpers walk every page for you, stopping when a page comes back shorter than the requested page size (Cumulocity's end-of-data signal).

| Function                       | Description                                          | Request Context |
| ------------------------------ | ---------------------------------------------------- | :-------------: |
| `fetchAllPages(source, opts?)` | Collect every item across all pages into one array   |       ❌        |
| `paginate(source, opts?)`      | Async-iterate every item one at a time (`for await`) |       ❌        |
| `paginatePages(source, opts?)` | Async-iterate whole pages (`T[]`) for batch work     |       ❌        |

`source` is the **first page** in whichever shape you have on hand — an awaited `IResultList`, the pending `list()` promise, or a thunk `() => client.x.list(...)`. Every subsequent page is fetched via the result's own `paging.next()`, which reuses the exact client, auth, and filter that produced the first page — so you never pass a client and there is no ambiguity between user, tenant, or microservice clients.

`opts` accepts optional safety guards: `maxPages` (stop after N pages) and `maxItems` (stop after N items, truncating the crossing page).

```ts
import { fetchAllPages, paginate } from 'c8y-nitro/utils'

// Collect everything (await until done):
const client = useUserClient(event)
const all = await fetchAllPages(client.inventory.list({ pageSize: 2000, fragmentType: 'c8y_Sensor' }))

// Stream one entry at a time (low memory):
for await (const alarm of paginate(() => client.alarm.list({ pageSize: 2000, status: 'ACTIVE' }))) {
  await handleAlarm(alarm)
}
```

See [Paging](/guide/pagination) for the full guide.

## Realtime

| Function                         | Description                                                  | Request Context |
| -------------------------------- | ------------------------------------------------------------ | :-------------: |
| `useTenantRealtimeClient(input)` | Get the pooled Notification 2.0 realtime client for a tenant |    optional     |

`input` is whatever identifies the tenant — a tenant id, that tenant's `ICredentials`, a `@c8y/client` `Client`, or the current request (`H3Event`/`ServerRequest`). It always connects with the tenant's **service** credentials. Register handlers on the returned client:

```ts
import { useTenantRealtimeClient } from 'c8y-nitro/utils'

const rt = await useTenantRealtimeClient(event)
rt.alarms.onCreate('*', (alarm) => log.info(alarm.severity, alarm.text))
rt.measurements.onCreate('device42', (m) => log.info(m.type, m.time))
```

Clients are pooled per tenant and kept healthy across credential rotation and unsubscribe → resubscribe. See [Realtime](/guide/realtime).

## Middleware

| Function                                   | Description                                           | Request Context |
| ------------------------------------------ | ----------------------------------------------------- | :-------------: |
| `hasUserRequiredRole(role\|roles)`         | Check whether the current user has the required roles |       ✅        |
| `isUserFromAllowedTenant(tenant\|tenants)` | Check whether the user belongs to an allowed tenant   |       ✅        |
| `isUserFromDeployedTenant()`               | Check whether the user belongs to the deployed tenant |       ✅        |

Probe requests targeting the configured liveness and readiness paths bypass these auth helpers so platform health checks are not blocked.