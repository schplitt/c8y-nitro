# Tenant Options

Tenant options are runtime settings for your microservice. They are a good fit for values that differ between tenants or should be changed without rebuilding the service.

## Define Options in the Manifest

Add settings to `c8y.manifest.settings`:

```ts
export default defineNitroConfig({
  c8y: {
    manifest: {
      settingsCategory: 'my-service',
      // ROLE_OPTION_MANAGEMENT_READ is auto-added; add ROLE_OPTION_MANAGEMENT_ADMIN yourself to write/delete.
      requiredRoles: ['ROLE_OPTION_MANAGEMENT_ADMIN'],
      settings: [
        { key: 'featureMode', defaultValue: 'standard', editable: true },
        { key: 'credentials.apiKey', defaultValue: 'change-me' },
      ],
    },
  },
  modules: [c8y()],
})
```

Each setting must have a non-empty `defaultValue`. Empty defaults are rejected while generating the manifest so bad settings fail early.

> **Roles**: When `settings` are defined, `ROLE_OPTION_MANAGEMENT_READ` is added to the manifest automatically so the service can read its options. Writing or deleting options requires `ROLE_OPTION_MANAGEMENT_ADMIN`, which you must add to `requiredRoles` yourself.

## Which Tenant?

Tenant options live **per tenant**. A multi-tenant microservice must be explicit about which tenant it reads from or writes to, so the API takes a Cumulocity `Client` as its first argument — the client carries both the target tenant and its service-user credentials.

Get a client from one of the [client helpers](/guide/api-client):

- `useDeployedTenantClient()` — the microservice's owner/deployed tenant (its own configuration).
- `useUserTenantClient(event)` — the tenant of the current request's user (per-subscriber configuration).
- `useSubscribedTenantClients()` — every subscribed tenant.

## Read and Write at Runtime

`useTenantOption(client, key)` returns a handle for a single option; `useTenantOptions(client)` returns a handle for a whole category.

```ts
import {
  useTenantOption,
  useTenantOptions,
  useDeployedTenantClient,
  useUserTenantClient,
} from 'c8y-nitro/utils'

// The microservice's own config (owner tenant):
const client = await useDeployedTenantClient()
const featureMode = await useTenantOption(client, 'featureMode').read()
const apiKey = await useTenantOption(client, 'credentials.apiKey').read()

// A subscriber's config (current request's tenant):
const tenantClient = await useUserTenantClient(event)
await useTenantOption(tenantClient, 'featureMode').set('advanced')
```

Each handle exposes:

| Method                                    | Description                                             |
| ----------------------------------------- | ------------------------------------------------------- |
| `read()`                                  | Current value, or `undefined` if unset (404)            |
| `set(value)`                              | Create or update (upsert)                               |
| `getOrInsert(fallback)`                   | Read; if unset, write `fallback` and return it          |
| `delete()`                                | Remove the option (idempotent)                          |
| `setEditable(editable, { targetTenant })` | Update the `editable` flag — **management tenant only** |
| `refresh()` / `invalidate()`              | Cache control for this option                           |

Keys defined in the manifest are generated into the `C8YTenantOptionKey` type, so TypeScript autocompletes them — but any other string is accepted too, so dynamic keys work (see below).

## Dynamic Keys

You are not limited to manifest-declared keys. Any string works, which is useful when the key is computed at runtime (for example a per-record encrypted secret):

```ts
const client = await useDeployedTenantClient()
const secret = await useTenantOption(client, `encrypted.password.${hash}`).getOrInsert('')
```

## Whole Categories

```ts
const options = useTenantOptions(client)

const all = await options.list() // { key: value, ... }
await options.setAll({ featureMode: 'x', ttl: '30' })
await options.option('featureMode').read()
```

## Other Categories

By default the category is your microservice's own (resolved below). Pass a different category to read or write options that live elsewhere:

```ts
// Whole category:
const all = await useTenantOptions(client, 'other-service').list()

// A single option in a foreign category (via the category handle):
const value = await useTenantOptions(client, 'other-service').option('someKey').read()
// …with key autocomplete:
await useTenantOptions<'someKey'>(client, 'other-service').option('someKey').set('x')
```

`useTenantOption(client, key)` is only a shortcut for the **own** category — it has no category parameter. Use `useTenantOptions(client, category).option(key)` for a single option elsewhere.

`credentials.*` keys are **rejected at compile time** for foreign categories, because encrypted options can only be decrypted within their owning microservice's category. Pass the key set as a type argument to get autocomplete for a foreign category's keys:

```ts
await useTenantOptions<'featureA' | 'featureB'>(client, 'other-service').option('featureA').read()
```

## Category Resolution

The option category is resolved in this order:

1. `manifest.settingsCategory`
2. generated manifest `contextPath`
3. generated manifest `name`

Use an explicit `settingsCategory` when you want stable option storage independent from package naming or context-path changes.

## Missing Options

If Cumulocity returns 404 for an option, `read()` returns `undefined`. Other failures (e.g. a missing `ROLE_OPTION_MANAGEMENT_*` role) are thrown as a **generic 500** — the specifics (operation, upstream status, required role) are logged via the error's `internal` field and never included in the HTTP response, so nothing about tenant options leaks to the caller.

## Encrypted Options

Keys prefixed with `credentials.` are stored encrypted by Cumulocity. Use this for secrets that tenants configure through platform options. They can only be read within the microservice's own category (never a foreign category).

## Cache Control

Reads are cached for 10 minutes by default, keyed per tenant (`${tenant}::${category}::${key}`) so different tenants never share a cached value. You can tune the default or override individual keys:

```ts
export default defineNitroConfig({
  c8y: {
    cache: {
      defaultTenantOptionsTTL: 600,
      tenantOptions: {
        'featureMode': 60,
        'credentials.apiKey': 300,
      },
    },
  },
  modules: [c8y()],
})
```

Writes (`set`, `getOrInsert`, `delete`, `setAll`) invalidate the affected cache entries automatically. You can also manage caches manually at three levels:

```ts
// one option:
await useTenantOption(client, 'featureMode').invalidate()
const fresh = await useTenantOption(client, 'featureMode').refresh()

// one tenant + category:
await useTenantOptions(client).invalidateAll()
const values = await useTenantOptions(client).refreshAll()

// everything, across all tenants and categories:
await useTenantOptions.invalidateAll()
await useTenantOptions.refreshAll()
```

`invalidateAll()` and `refreshAll()` only operate on keys that have already been accessed in the current process.

## Debug Invalidation Route

Set `enableTenantOptionsInvalidationRoute: true` to expose:

```txt
GET /_c8y_nitro/invalidate-tenant-options?key=featureMode
GET /_c8y_nitro/invalidate-tenant-options?all=true
```

This is meant for debugging and operational troubleshooting. Keep it disabled unless you have a clear reason to expose it.