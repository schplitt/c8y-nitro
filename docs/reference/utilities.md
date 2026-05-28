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
- Use `Scheduled Tasks` when work should happen later instead of inline with a request.

For longer examples, see [Tenant Options](/guide/tenant-options), [Auth Middleware](/guide/auth-middleware), and [Scheduled Tasks](/guide/scheduled-tasks).

## Credentials

| Function                           | Description                                   | Request Context |
| ---------------------------------- | --------------------------------------------- | :-------------: |
| `useSubscribedTenantCredentials()` | Get credentials for all subscribed tenants    |       ❌        |
| `useDeployedTenantCredentials()`   | Get credentials for the deployed tenant       |       ❌        |
| `useUserTenantCredentials()`       | Get credentials for the current user's tenant |       ✅        |

`useDeployedTenantCredentials()` shares its cache with `useSubscribedTenantCredentials()`. Both support `.invalidate()` and `.refresh()`.

### Tenant Credentials Lifecycle Hook

`c8y-nitro` emits `c8y:tenantCredentialsUpdated` when the subscribed credentials cache is populated for the first time or refreshed with a changed tenant set.

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

| Function            | Description                      | Request Context |
| ------------------- | -------------------------------- | :-------------: |
| `useTenantOption()` | Get a tenant option value by key |       ❌        |

```ts
import { useTenantOption } from 'c8y-nitro/utils'

const value = await useTenantOption('myOption')
const secret = await useTenantOption('credentials.apiKey')

await useTenantOption.invalidate('myOption')
const fresh = await useTenantOption.refresh('myOption')
await useTenantOption.invalidateAll()
await useTenantOption.refreshAll()
```

If a tenant option is missing, `useTenantOption()` returns `undefined` for a 404 instead of throwing.

## Scheduled Tasks

| Function                | Description                              |
| ----------------------- | ---------------------------------------- |
| `scheduleTask()`        | Schedule a Nitro task once in the future |
| `listScheduledTasks()`  | List pending scheduled tasks by UUID     |
| `cancelScheduledTask()` | Cancel a pending scheduled task          |

The scheduler is built on Nitro tasks and supports `number`, `string`, or `Date` schedules.

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

## Middleware

| Function                                   | Description                                           | Request Context |
| ------------------------------------------ | ----------------------------------------------------- | :-------------: |
| `hasUserRequiredRole(role\|roles)`         | Check whether the current user has the required roles |       ✅        |
| `isUserFromAllowedTenant(tenant\|tenants)` | Check whether the user belongs to an allowed tenant   |       ✅        |
| `isUserFromDeployedTenant()`               | Check whether the user belongs to the deployed tenant |       ✅        |

Probe requests targeting the configured liveness and readiness paths bypass these auth helpers so platform health checks are not blocked.