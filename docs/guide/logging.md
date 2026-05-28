# Logging

`c8y-nitro` builds on [evlog](https://www.evlog.dev) to provide wide-event logging: one structured log event per request that accumulates context over the lifetime of the request.

evlog is configured automatically by the module. The service name is derived from your package metadata.

This keeps request logs readable in production because you are building up one event with context, instead of scattering partial lines throughout the request path.

## Request-Scoped Logging

Use `useLogger(event)` inside route handlers.

```ts
import { defineEventHandler } from 'nitro/h3'
import { useLogger, useUser } from 'c8y-nitro/utils'

export default defineEventHandler(async (event) => {
  const log = useLogger(event)

  const user = await useUser(event)
  log.set({ action: 'process-order', user: { id: user.userName } })
  log.set({ order: { id: '42', total: 9999 } })

  return { success: true }
})
```

If you enable `experimental.asyncContext: true`, you can use Nitro's request context to access the logger deeper in the call stack.

## Structured Errors

Prefer `createError` from `c8y-nitro/utils` over Nitro's built-in helper.

```ts
import { defineEventHandler } from 'nitro/h3'
import { createError, useLogger } from 'c8y-nitro/utils'

export default defineEventHandler(async (event) => {
  const log = useLogger(event)
  log.set({ action: 'payment', userId: 'user_123' })

  throw createError({
    message: 'Payment failed',
    status: 402,
    why: 'Card declined by issuer (insufficient funds)',
    fix: 'Try a different payment method or contact your bank',
    link: 'https://docs.example.com/payments/declined',
  })
})
```

This keeps `why`, `fix`, and `link` available both in the emitted log event and in the JSON response payload.

## Standalone Logging

For tasks, jobs, and code outside request handlers, use `createLogger()` and call `emit()` manually.

```ts
import { createLogger } from 'c8y-nitro/utils'

export async function processSubscriptionRenewal(tenantId: string) {
  const log = createLogger({ job: 'subscription-renewal', tenantId })

  log.set({ subscription: { id: 'sub_123', plan: 'pro' } })
  log.set({ result: 'renewed' })

  log.emit()
}
```

Use this form for tasks, background refresh jobs, or other code that runs without an HTTP request lifecycle.