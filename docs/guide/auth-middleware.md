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

## Probe Bypass

Requests targeting the configured liveness or readiness probe path bypass these middleware helpers.

That means a broad route-level auth policy will not accidentally block platform health checks.

## Development User Injection

In local dev, [Development User Injection](/guide/dev-user) provides the user context these middleware helpers need. Disable it only if a local proxy already supplies the incoming auth context.