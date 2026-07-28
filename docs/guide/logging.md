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

`useLogger()` accepts **either** an `H3Event` (as received by a handler) **or** the `ServerRequest` returned by Nitro's `useRequest()` — both carry the same request context. With `experimental.asyncContext: true` you can therefore reach the logger deeper in the call stack without threading the event through every function:

```ts
import { useRequest } from 'nitro/context'
import { useLogger } from 'c8y-nitro/utils'

function deepHelper() {
  const log = useLogger(useRequest())
  log.set({ step: 'deep-helper' })
}
```

## Structured Errors

Always prefer `createError` from `c8y-nitro/utils` (re-exported from evlog) over Nitro/h3's built-in `createError`. It produces an error that is both captured in the wide log event and serialized into a structured JSON response.

```ts
import { defineEventHandler } from 'nitro/h3'
import { createError, useLogger } from 'c8y-nitro/utils'

export default defineEventHandler(async (event) => {
  const log = useLogger(event)
  log.set({ action: 'payment', userId: 'user_123' })

  throw createError({
    code: 'PAYMENT_DECLINED',
    message: 'Payment failed',
    status: 402,
    why: 'Card declined by issuer (insufficient funds)',
    fix: 'Try a different payment method or contact your bank',
    link: 'https://docs.example.com/payments/declined',
  })
})
```

### What is sent to the client vs kept on the server

This is the field you most need to get right. **Everything except `internal` is serialized into the HTTP response** (under a `data` key) and is therefore visible to the caller. `internal` is stripped from the response and lives only in your logs.

| Field      | In HTTP Response? | Use It For                                                                 |
| ---------- | :---------------: | -------------------------------------------------------------------------- |
| `message`  |        ✅         | Short, safe summary of what went wrong.                                    |
| `status`   |        ✅         | HTTP status code (default `500`).                                          |
| `code`     |        ✅         | Stable, machine-readable id (e.g. `'PAYMENT_DECLINED'`) clients branch on. |
| `why`      |        ✅         | Human-readable cause — **safe to expose**; do not put secrets here.        |
| `fix`      |        ✅         | What the caller can do about it.                                           |
| `link`     |        ✅         | Docs URL with more detail.                                                 |
| `cause`    |    ❌ (logged)    | The original `Error` you caught.                                           |
| `internal` |    ❌ (logged)    | **Backend-only** diagnostics: raw upstream payloads, stack context, ids.   |

### Do not leak internal system errors

The most common mistake is dumping an upstream/system failure into `message` or `why`, which sends it straight to the caller. Put anything sensitive or diagnostic — raw Cumulocity core responses, database errors, tokens, tenant internals — into `internal` instead. It is logged for you to debug with, but never reaches the client.

```ts
try {
  await doUpstreamThing()
} catch (cause) {
  throw createError({
    status: 502,
    message: 'Upstream request failed', // safe, generic — this is what the caller sees
    why: 'Cumulocity core did not respond successfully',
    cause: cause as Error,
    internal: {
      // never exposed — only in the wide log event
      upstreamStatus: (cause as any)?.res?.status,
      upstreamBody: (cause as any)?.data,
    },
  })
}
```

> `@c8y/client` rejects with plain `{ res, data }` objects rather than `Error` instances on HTTP failures. Normalize those into a `createError` at your boundary and keep the raw `{ res, data }` in `internal`.

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