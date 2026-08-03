# Realtime

Consume Cumulocity **Notification 2.0** realtime streams — alarms, events, measurements, managed objects, operations — from any subscribed tenant, without managing connections, tokens, or credentials yourself.

It is built on [`c8y-realtime`](https://github.com/schplitt/c8y-realtime): `c8y-nitro` pools one realtime client per tenant and keeps it alive across credential changes; the typed handler API is the library's.

::: tip Notification 1.0 is not used
The CometD-based Notification 1.0 surface (`client.realtime`) is RBAC-unaware and superseded. Use the realtime client below for streaming.
:::

## Getting a client

`useTenantRealtimeClient(input)` returns the pooled client for a tenant, creating it on first use and reusing it after. Pass **whatever identifies the tenant** — it always connects with that tenant's **service** credentials:

```ts
import { useTenantRealtimeClient } from 'c8y-nitro/utils'

const rt = await useTenantRealtimeClient(event) // an H3Event / ServerRequest
// or a tenant id:            useTenantRealtimeClient('t12345')
// or a @c8y/client Client:   useTenantRealtimeClient(client)
// or ICredentials:           useTenantRealtimeClient(creds)
```

Because only Notification 2.0 (which ignores RBAC) is used, realtime always runs on **service credentials** — never a user's auth. There is deliberately no user-scoped realtime accessor.

## Registering handlers

Register handlers directly on the returned client — the first argument is the device (`'*'` for all devices, or a device id). Payloads are fully typed:

```ts
const rt = await useTenantRealtimeClient(event)

rt.alarms.onCreate('*', (alarm) => log.info(alarm.severity, alarm.text))
rt.measurements.onCreate('device42', (m) => log.info(m.type, m.time))
rt.events.onDelete('*', ({ id }) => log.info('deleted', id))

// Same thing as a single key string:
rt.hook('alarms:create:*', (alarm) => log.info(alarm.severity))

// Every notification:
rt.onAny((payload, n) => log.info(n.description.type, n.action))
```

See the [`c8y-realtime` docs](https://github.com/schplitt/c8y-realtime) for the full handler surface (`onCreate`/`onUpdate`/`onDelete`/`onAny`, scoping rules, `unsubscribe`/`detach`/`hookKeys`, persistence).

## Lifecycle

Clients are pooled per tenant and created lazily on first use. You do not manage the connection — `c8y-nitro` keeps it healthy:

- **Credential rotation** (a tenant's service-user password changes) and **unsubscribe → resubscribe** are handled automatically: the pooled client is repaired in place with the new credentials, so its handlers keep firing and, for persistent subscriptions, the backlog missed while it was down is drained on reconnect. Nothing is re-registered.
- **A tenant that unsubscribes** is left idle with its handlers kept, ready to resume if it comes back — the client is not torn down.
- **On shutdown**, all clients are closed so no sockets leak. Remote subscriptions are **not** deleted, so a restart resumes where it left off.
- A remote subscription is deleted only when you remove its **last** handler (the library's `deleteSubscriptionOnEmpty`).

## Configuration

Realtime options are set once under `c8y.realtime` and applied to every tenant's client. The client `name` — the platform topic identity — is derived from your microservice `contextPath` by default (stable across restarts, unique per service); override it only if you must.

```ts
export default defineNitroConfig({
  c8y: {
    realtime: {
      // name: 'myservice',  // optional; derived from contextPath by default
      autoAck: true,
      dedupe: true,
      subscription: { nonPersistent: false },
    },
  },
})
```

See [Module Options](/reference/module-options#realtime) for the full list.

## Requirements

Notification 2.0 uses the runtime's global `WebSocket` (Node 22+); `c8y-nitro` already targets a newer Node, so there is nothing to install.
