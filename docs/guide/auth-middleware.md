# Auth Middleware

`c8y-nitro` includes middleware helpers for the checks Cumulocity microservices usually need around user roles and tenants.

## Role Checks

Use `hasUserRequiredRole()` when a route should only be available to users with one of the required roles.

```ts
import { defineHandler } from 'nitro/h3'
import { hasUserRequiredRole } from 'c8y-nitro/utils'

export default defineHandler({
  middleware: [hasUserRequiredRole('ROLE_MY_SERVICE_ADMIN')],
  handler: async () => {
    return { ok: true }
  },
})
```

Pass multiple roles when any one of them should allow access:

```ts
hasUserRequiredRole(['ROLE_MY_SERVICE_ADMIN', 'ROLE_INVENTORY_ADMIN'])
```

## Tenant Checks

Use `isUserFromAllowedTenant()` to allow one or more specific tenants:

```ts
import { defineHandler } from 'nitro/h3'
import { isUserFromAllowedTenant } from 'c8y-nitro/utils'

export default defineHandler({
  middleware: [isUserFromAllowedTenant(['t12345', 't67890'])],
  handler: async () => {
    return { ok: true }
  },
})
```

Use `isUserFromDeployedTenant()` when only users from the tenant hosting the microservice should pass.

```ts
import { defineHandler } from 'nitro/h3'
import { isUserFromDeployedTenant } from 'c8y-nitro/utils'

export default defineHandler({
  middleware: [isUserFromDeployedTenant()],
  handler: async () => {
    return { ok: true }
  },
})
```

## Composed / Imperative Authorization

The helpers above are middleware: they run before the handler and **throw** on failure. That is the right tool when access is a simple "has one of these roles / tenants" gate.

Sometimes authorization is a condition you have to evaluate *inside* the handler — for example "either the caller has a read role **OR** they own this specific resource". For those cases, do **not** re-implement role fetching, the 403 shape, or probe handling from scratch. Compose from the same building blocks the middleware use:

- `useUserRoles(event)` — the caller's effective roles (cached per request).
- `useUserClient(event)` — a Cumulocity client authenticated **as the caller**, so you can defer a per-resource decision to core: if core lets the user read it, so do you.
- `createError({ status, message, why })` — the structured error the rest of the stack expects (see [Logging](/guide/logging#structured-errors)).

```ts
import type { H3Event } from 'nitro/h3'
import { createError, useUserClient, useUserRoles } from 'c8y-nitro/utils'

const READ_ROLES = ['ROLE_MEASUREMENT_READ', 'ROLE_MEASUREMENT_ADMIN']

/**
 * Allow if the caller has a global read role — OR — core lets *them* read the
 * source (owner / inventory-role permission). We do not re-implement the
 * per-source check: we probe core as the caller and mirror its answer.
 */
export async function assertMeasurementRead(event: H3Event, source: string): Promise<void> {
  const roles = await useUserRoles(event)
  if (roles.some(role => READ_ROLES.includes(role)))
    return

  const client = useUserClient(event)
  const response = await client.core.fetch(
    `/measurement/measurements?source=${encodeURIComponent(source)}&pageSize=1&withTotalPages=false`,
  )
  if (response.status === 401 || response.status === 403) {
    throw createError({
      status: 403,
      message: 'Not authorized to read measurements of this source',
      why: 'Caller has neither a global read role nor read access to the source in Cumulocity core',
    })
  }
  if (!response.ok) {
    throw createError({
      status: 502,
      message: 'Could not verify measurement read permission against Cumulocity core',
      // Keep the raw upstream status server-side only — see Logging § internal.
      internal: { coreStatus: response.status },
    })
  }
}
```

Rule of thumb: reach for a **middleware helper** when the check is a plain role/tenant gate; reach for the `useUserRoles` + `useUserClient` + `createError` trio when the decision is conditional, per-resource, or needs to defer to core. Either way you are reusing `c8y-nitro`'s primitives rather than rebuilding auth context resolution.

## Probe Bypass

Requests targeting the configured liveness or readiness probe path bypass these middleware helpers.

That means a broad route-level auth policy will not accidentally block platform health checks.

## Development User Injection

In local dev, [Development User Injection](/guide/dev-user) provides the user context these middleware helpers need. Disable it only if a local proxy already supplies the incoming auth context.