# Runtime Hooks

`c8y-nitro` augments Nitro runtime hooks with one public hook today.

## `c8y:tenantCredentialsUpdated`

This hook fires when the subscribed tenant credentials cache is populated for the first time or refreshed with a changed tenant set.

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

## Payload Meaning

- `prev` is `null` the first time the cache is populated.
- `prev` is otherwise the previous cached tenant credential map.
- `next` is the newly fetched tenant credential map.

Refreshing with the same tenant ID set does not emit the hook.

## When To Use It

Use this hook when another part of your application needs to react to tenant subscription changes, for example to refresh dependent in-memory state or record operational events.