# Testing

`c8y-nitro/testing` lets you test your microservice against a fake Cumulocity tenant. Your service runs unchanged and uses the real `@c8y/client`. Its requests are answered by an in-memory tenant instead of the network.

A test works in three steps:

1. **Arrange** the platform as data: the user calling your service, devices, measurements, alarms, tenant options, and so on.
2. **Act**: call a route of your service with `serverFetch()`, optionally as a specific user.
3. **Assert** on what your service did: its response, and the data it changed in the platform.

Your tests describe what your service does, not which Cumulocity endpoints it calls. You can refactor the service, for example from `inventory.detail()` to `inventory.list()`, without touching a test.

Tests run in [Nitro's Vitest environment](https://nitro.build/docs/testing): each test file gets its own Nitro app, without a dev server.

## Setup

Install Vitest and Vite:

```sh
pnpm add -D vitest vite
```

Add `nitro()` and `c8yTest()` to `vitest.config.ts`:

```ts [vitest.config.ts]
import { nitro } from 'nitro/vite'
import { c8yTest } from 'c8y-nitro/testing/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    nitro(),
    // The default user calling your service (see Personas)
    c8yTest({
      user: { userName: 'operator', roles: ['ROLE_INVENTORY_READ', 'ROLE_ALARM_ADMIN'] },
    }),
  ],
})
```

Then run `vitest`. Nothing reaches a real tenant, and auto-bootstrap is skipped. The plugin sets the `C8Y_*` environment variables for you.

## Example

A pump-monitoring service has two routes. `GET /pumps/:serial` returns a pump's latest temperature. `POST /pumps/:serial/check` raises an alarm when the pump is too hot:

```ts [routes/pumps/[serial]/check.post.ts]
export default defineHandler({
  middleware: [hasUserRequiredRole('ROLE_ALARM_ADMIN')],
  handler: async (event) => {
    const client = await useUserTenantClient(event)
    const pump = await findPump(client, getRouterParam(event, 'serial')!) // identity + inventory
    const temperature = await latestTemperature(client, pump.id) // measurements
    const maxTemperature = Number(await useTenantOption(client, 'maxTemperature').read() ?? 80)

    const overheating = temperature !== null && temperature > maxTemperature
    if (overheating) {
      await client.alarm.create({ source: { id: pump.id }, type: 'pump_Overheating', severity: 'CRITICAL', /* … */ })
    }
    return { temperature, maxTemperature, overheating }
  },
})
```

The tests seed the fake Cumulocity tenant with a pump and its measurements, call the service with `serverFetch()`, and check the result. `c8y` is only the fake platform. `serverFetch()` from `c8y-nitro/testing` is Nitro's `serverFetch()` plus an `as` option for the calling user:

```ts [test/pumps.test.ts]
import { describe, expect, it } from 'vitest'
import { c8y, definePersona, serverFetch } from 'c8y-nitro/testing'

const pump = c8y.device({ name: 'Pump 1', externalIds: { c8y_Serial: 'SN-1' } })
const visitor = definePersona({ userName: 'visitor', roles: [] })
c8y.seed({ users: [visitor] })

describe('POST /pumps/:serial/check', () => {
  describe('when the pump is too hot', () => {
    c8y.seed({
      measurements: [{ source: pump, type: 'c8y_Temperature', c8y_Temperature: { T: { value: 95, unit: 'C' } } }],
    })

    it('raises a critical overheating alarm', async () => {
      const res = await serverFetch('/pumps/SN-1/check', { method: 'POST' })

      expect(await res.json()).toEqual({ temperature: 95, maxTemperature: 80, overheating: true })
      expect(c8y.db.alarms.find({ source: pump })).toMatchObject([
        { type: 'pump_Overheating', severity: 'CRITICAL', status: 'ACTIVE' },
      ])
    })

    it('respects the configured maximum temperature', async () => {
      c8y.tenantOptions.set('maxTemperature', '100')

      const res = await serverFetch('/pumps/SN-1/check', { method: 'POST' })

      expect((await res.json()).overheating).toBe(false)
      expect(c8y.db.alarms.find({ source: pump })).toEqual([])
    })
  })

  it('answers 404 for an unknown pump', async () => {
    expect((await serverFetch('/pumps/SN-404/check', { method: 'POST' })).status).toBe(404)
  })

  it('requires the alarm admin role', async () => {
    expect((await serverFetch('/pumps/SN-1/check', { method: 'POST', as: visitor })).status).toBe(403)
  })
})
```

The [playground](https://github.com/schplitt/c8y-nitro/tree/main/playground) contains the full example.

## Arrange the Platform

### Devices and Managed Objects

`c8y.device()` creates a device (a managed object with `c8y_IsDevice`). `c8y.managedObject()` creates any managed object. Both take fragments plus a few relation shortcuts, and return a ref. The ref's `id` is available while a test runs:

```ts
const sensor = c8y.device({ name: 'Sensor', c8y_Hardware: { model: 'S1' } })
const gateway = c8y.device({
  name: 'Gateway',
  children: [sensor], // childDevices (also: assets, additions)
  externalIds: { c8y_Serial: 'GW-1' }, // identity
})
c8y.managedObject({ name: 'Plant A', type: 'c8y_DeviceGroup', assets: [gateway] })

it('…', async () => {
  await serverFetch(`/devices/${gateway.id}`)
})
```

### Measurements, Events, Alarms, Operations, and More

```ts
c8y.seed({
  measurements: [{ source: pump, type: 'c8y_Temperature', time: '2026-01-01T10:00:00Z', c8y_Temperature: { T: { value: 21.5, unit: 'C' } } }],
  events: [{ source: pump, type: 'c8y_DoorOpened' }],
  alarms: [{ source: pump, type: 'c8y_LowPressure', severity: 'MINOR' }],
  operations: [{ deviceId: pump, c8y_Restart: {} }],
})
```

Seeds get the same treatment as writes from your service:

- **Validation:** required fields, enum values such as operation statuses, and the source must exist. Like the platform, alarm severity and status are not validated.
- **Defaults:** `time` defaults to now, `text` to the type, and alarm `severity` to `MAJOR`.
- **Platform behavior:** alarms are deduplicated, and operations start as `PENDING`.

`c8y.seed()` also takes `measurementGenerators` (measurement history computed on read), `newDeviceRequests`, `retentionRules`, `auditRecords`, `users`, `groups`, `roles`, `inventoryRoles`, and `applications`. See fake-c8y's [seeding guide](https://github.com/schplitt/fake-c8y/blob/main/docs/world.md#seeding) for the inputs.

### Files (Binaries)

```ts
const manual = c8y.binary({ name: 'manual.txt', content: 'Turn it off and on again.' })
```

A binary is a managed object with `c8y_IsBinary` and the file's content. Your service can download it with `client.inventoryBinary.download()`, and its uploads end up in the fake tenant too. Check them with `c8y.db.binaries.content(id).text()`. Event attachments are stored the same way: read them with `c8y.db.events.attachment(eventId)`.

### Subscriptions and Tenant Options

```ts
c8y.subscriptions.add({ tenant: 't99999', user: 'service_t99999', password: 'pw' })
c8y.tenantOptions.set('maxTemperature', '100')
```

- **Service users** of the subscribed tenants are used by `useSubscribedTenantCredentials()`, `useDeployedTenantClient()`, and the other service clients. By default, the deployed tenant `t12345` is subscribed.
- **Data is kept per tenant.** Pass `tenant` to `c8y.device()` or `c8y.seed()`, or `{ tenant }` as the third argument of `c8y.tenantOptions.set()`, to arrange data for another tenant.

### Multiple Tenants

A multi-tenant service sees each subscribed tenant through its own service user. Subscribe more tenants and give them their own data:

```ts
c8y.subscriptions.add({ tenant: 't99999', user: 'service_t99999', password: 'pw' })
c8y.device({ name: 'Pump A' }) // deployed tenant (t12345)
c8y.device({ name: 'Pump B', tenant: 't99999' }) // subscribed tenant

it('reports devices per tenant', async () => {
  const res = await serverFetch('/reports/devices') // e.g. uses useSubscribedTenantClients()

  expect(await res.json()).toEqual({ t12345: 1, t99999: 1 })
  expect(c8y.db.tenant('t99999').alarms.find()).toEqual([])
})
```

Each request is answered with the data of the tenant it was sent to: the tenant of the credentials. Personas can belong to any tenant (`definePersona({ ..., tenant: 't99999' })`), so you can also test what users of a subscribed tenant see.

## Personas

A persona is a user that calls your service. It is a user of the fake tenant: seed it with `c8y.seed({ users })`, then pass it (or its name) as `as` to `serverFetch()`, so one test can compare different callers. `definePersona()` types a user once for both (role names autocomplete: your manifest's roles plus the known platform roles). Without `as`, the default `user` from the `c8yTest()` config calls.

```ts
import { c8y, definePersona, serverFetch } from 'c8y-nitro/testing'

const operator = definePersona({ userName: 'operator', roles: ['ROLE_INVENTORY_READ', 'ROLE_ALARM_ADMIN'] })
const visitor = definePersona({ userName: 'visitor', roles: [] })
const partner = definePersona({ userName: 'eve', roles: ['ROLE_ALARM_ADMIN'], tenant: 't99999' })

c8y.seed({ users: [operator, visitor, partner] }) // partner is seeded in t99999

it('only lets operators run the check', async () => {
  expect((await serverFetch('/pumps/SN-1/check', { method: 'POST', as: operator })).status).toBe(200)
  expect((await serverFetch('/pumps/SN-1/check', { method: 'POST', as: 'visitor' })).status).toBe(403)
})
```

- **One call:** `as` applies to that call only and stores nothing. The next call without `as` is made by the default user again.
- **Like a real user:** the caller reaches your service through [dev user injection](/guide/dev-user) (`serverFetch()` replaces an `authorization` header you pass). `useUser()`, `useUserRoles()`, the auth middleware, and `useUserClient()` see it, and the platform checks the requests your service sends with its credentials against its roles, like the platform: a caller without `ROLE_INVENTORY_READ` gets 403 from the inventory.
- **Seeded users only:** `as` with a user the fake tenant does not store throws. A persona of another tenant is seeded in its own `tenant`, also in the same call as the others: `c8y.seed({ users: [operator, partner] })`. Seeded users also get `ROLE_USER_MANAGEMENT_OWN_READ` and `ROLE_USER_MANAGEMENT_OWN_ADMIN`, like every platform user. Your manifest's `roles` exist in the tenant already; other custom roles must be seeded too: `c8y.seed({ roles: ['MY_ROLE'], users: [...] })`.
- **The default `user`** has full access on the platform, so tests that don't care about permissions work unchanged.
- **One caller at a time:** calls with `as` cannot run concurrently in one file.

There is no "not logged in" caller: the platform's API gateway never forwards a request without valid credentials to a microservice, so your service never sees one.

## Assert

Assert on your service's response first. Then assert on the platform data it changed, with `c8y.db`:

```ts
c8y.db.alarms.find({ source: pump, type: 'pump_Overheating' })
c8y.db.measurements.find({ source: pump })
c8y.db.managedObjects.get(gateway)
c8y.db.externalIds.find(pump)
c8y.db.tenant('t99999').alarms.find()
```

`find()` takes a partial object (refs match `source` and `deviceId`) or a predicate, and returns objects as the platform would: with `id`, `self`, `creationTime`, and the source name.

Some services wait for a device to process an operation. Drive the operation's status like the device would:

```ts
const { operationId } = await (await serverFetch('/pumps/SN-1/restart', { method: 'POST' })).json()
c8y.db.operations.update(operationId, { status: 'SUCCESSFUL' })
```

## Realtime

Services often react to platform data in real time: a [Nitro plugin](https://nitro.build/docs/plugins) subscribes with [`useTenantRealtimeClient()`](/guide/realtime) and handles new measurements, alarms, or operations. The fake tenant implements Notification 2.0, so these handlers run in tests:

```ts [plugins/overheating-trigger.ts]
export default definePlugin(async () => {
  const realtime = await useTenantRealtimeClient(process.env.C8Y_BOOTSTRAP_TENANT!)

  realtime.measurements.onCreate('*', async (measurement) => {
    if (measurement.c8y_Temperature?.T?.value > 80) {
      const client = await useDeployedTenantClient()
      await client.alarm.create({ source: { id: measurement.source.id }, type: 'pump_Overheating', severity: 'CRITICAL', /* … */ })
    }
  })
})
```

A test follows four steps:

1. **The service sets itself up.** The service and its plugins start before the test (see [Service Instances](#service-instances)). When tests share a service, the subscriptions it created at startup stay in place, and connected, for all of them, also when a consumer reconnects; subscriptions created during a test are removed before the next one, and realtime clients your service created after startup are closed. Subscribe at startup (in a plugin), not lazily in a route. The start waits until the startup work that runs through the fake tenant is done (requests, realtime clients that are connecting). If that work still runs 5 seconds after your plugins have finished, the test fails. Your manifest's `requiredRoles` must list `ROLE_NOTIFICATION_2_ADMIN`: without it, the realtime client stops with a 403 in the log and no listener opens.
2. **Trigger a write**, like a device would: `c8y.seed()` or `c8y.device()` inside the test, a route of your service, or `c8y.db.operations.update()`.
3. **Wait until it is processed:** `await c8y.notifications.settled()`. This waits until every delivered notification has been handled, including notifications caused by the handlers' own writes. Notifications of a subscription without a consumer are not waited for. Notifications are delivered on the real timers, also after `vi.useFakeTimers()`.
4. **Query the fake world** with `c8y.db`.

```ts [test/overheating-trigger.test.ts]
const pump = c8y.device({ name: 'Pump 1' })

it('raises an alarm when a pump reports a high temperature', async () => {
  c8y.seed({ measurements: [{ source: pump, type: 'c8y_Temperature', c8y_Temperature: { T: { value: 95, unit: 'C' } } }] })
  await c8y.notifications.settled()

  expect(c8y.db.alarms.find({ source: pump })).toMatchObject([{ type: 'pump_Overheating', severity: 'CRITICAL' }])
})
```

Data arranged at file or `describe` level is rebuilt before every test, but it is not a change, so it does not send notifications. Only writes during the test do. `c8y.notifications.subscriptions()` lists the subscriptions your service created, and `c8y.notifications.consumers()` the listeners it has open.

### When to poll first

`settled()` waits only for work the fake tenant can see. Some listeners open later than that: a realtime client a route creates lazily, one your service opens on its own timer, or a reconnect after a dropped connection (about 1 second later). Poll until the listener is open, then call `settled()`:

```ts
await serverFetch('/alarms/listen', { method: 'POST' }) // opens a listener lazily
await expect.poll(() => c8y.notifications.consumers({ tenant: c8y.tenant }).length).toBe(1)

c8y.seed({ alarms: [{ source: pump, type: 'pump_Test', text: 'Test', severity: 'MINOR' }] })
await c8y.notifications.settled()
```

`consumers(filter?)` lists the open listeners, one per socket. Filter by `tenant`, `subscription`, `subscriber`, or `token`.

## Scopes

Arrange calls apply to the scope they are called in:

| Where You Call It                      | Applies To                                           |
| -------------------------------------- | ---------------------------------------------------- |
| `c8yTest({...})` in `vitest.config.ts` | every test of the project (the baseline)             |
| top level of a test file               | every test in the file                               |
| inside `describe`                      | every test in that `describe`, including nested ones |
| inside a test or `beforeEach`          | that test only                                       |

Before every test, the fake tenant is rebuilt: the baseline first, then the file, then each enclosing `describe` from outer to inner, then the test. (The scopes a running service instance shares come back from the state saved after its startup; the deeper ones are replayed.) Nothing a test does on the platform, including data your service writes, leaks into the next test. IDs come out the same in every test and every run. Your service starts fresh for every test, unless tests share one; see [Service Instances](#service-instances).

| API                                                 | Inner Scope                                    |
| --------------------------------------------------- | ---------------------------------------------- |
| `c8y.device()`, `c8y.managedObject()`, `c8y.seed()` | adds data                                      |
| `c8y.tenantOptions.set()` / `.delete()`             | changes one key                                |
| `c8y.subscriptions.add()` / `.remove()`             | changes one tenant; `.set([...])` replaces all |
| `c8y.override()`                                    | stacks: inner and newer overrides win          |

Arrange calls at file and `describe` level run before your own `beforeEach` hooks. Arrange calls cannot be used in `beforeAll()` or `afterAll()`, because state is rebuilt before every test (`c8y.startService()` is not an arrange call: it belongs in `beforeAll()`). Use file or `describe` level instead.

## Service Instances

By default, **every test gets its own instance of your service** (a new Nitro app): before the test, the fake tenant is arranged for it, and the service starts on that data. Plugins run, startup requests go out, realtime subscriptions connect, and caches start empty. Tests are isolated without you thinking about it.

On the platform, one instance serves many requests and keeps its caches. To test that, let tests share one, with Vitest's own hooks and `c8y.startService()`:

```ts
import { beforeAll, beforeEach, describe, it } from 'vitest'
import { c8y } from 'c8y-nitro/testing'

describe('caching', () => {
  // one service for the tests of this describe
  beforeAll(() => c8y.startService())

  it('reads the maximum temperature once', async () => { /* … */ })
  it('serves it from the cache afterwards', async () => { /* … */ })

  describe('reloading', () => {
    // a new service for every test here
    beforeEach(() => c8y.startService())
  })
})

it('boots with the new subscription', async () => {
  c8y.subscriptions.add({ tenant: 't2', user: 'service_t2', password: 'pw' })
  await c8y.startService() // a new service now, on what this test arranged
})
```

| Where You Call It                      | Effect                                                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| (nothing)                              | every test gets its own service                                                                          |
| `beforeAll(() => c8y.startService())`  | the tests of that `describe` (or of the file, at the top level), nested ones included, share one service |
| `beforeEach(() => c8y.startService())` | every test of that scope gets a new service (inside a scope that shares one)                             |
| `await c8y.startService()` in a test   | a new service starts now, on what the test arranged so far                                               |
| `c8yTest({ service: 'per-file' })`     | the tests of every file share one service, unless the file says otherwise                                |

- **A shared service starts before the first test of its scope,** on the data arranged down to that scope (the `c8yTest()` baseline, the file, and the `describe` blocks down to the one with the `beforeAll`). Before every test, the fake tenant goes back to the state right after that startup, and the deeper `describe` blocks' arrange calls apply on top. The service keeps running, with its caches: when a test changes what your service has cached (a tenant option, the subscribed tenants), the service only sees it once the cache expires.
- **One service runs at a time.** Tests outside the scope get their own service again. A nested `describe` with its own `beforeAll(() => c8y.startService())` gets its own shared service, so the outer scope's tests after it get a new shared one. A test that started a new service with `await c8y.startService()` hands a new one to the next test of its scope, and keeps its own call log.
- **`beforeEach(() => c8y.startService())`** replaces the service the test was about to run on, so the service starts twice for that test. Use it only inside a scope that shares one.
- **Retries:** a retried test gets a new service by default. In a scope that shares one, it runs on that service again.
- **What a new service resets:** Nitro's `close` hook runs on the old instance, plugins run again, `c8yTasks()` jobs of the old instance stop (plugins schedule theirs again), the first `c8y:tenantCredentialsUpdated` comes from `null`, and c8y-nitro's caches (credentials, tenant options, the caller's tenant id and tenant domain) and realtime clients start empty. It does **not** reset module state of your own files or caches you define with `defineCachedFunction` (invalidate those in a `beforeEach` if a test needs them empty): modules are loaded once per test file.
- **Cost:** every new service runs your startup work. If that is slow, share one where tests don't depend on fresh caches.
- **Concurrent tests** (which cannot arrange data) share one service on a clean tenant, and see each other's writes.

## Failures and Unsupported APIs: `c8y.override()`

Some situations can't be expressed as data, such as a platform error or a timeout. For those, override the platform's answer for matching requests:

```ts
it('fails while the inventory is unavailable', async () => {
  c8y.override('GET /inventory/**', () => Response.json({ message: 'Unavailable' }, { status: 503 }))

  // c8y-nitro turns platform errors your service does not handle into a 500
  expect((await serverFetch('/pumps/SN-1')).status).toBe(500)
})
```

- **Patterns** are `"[METHOD ]/path"`. Path segments can be `:name` (captured in `params`), `*` (any one segment), or `**` (the rest of the path).
- **The handler's return value:** return a `Response` for any status, any other value for `200` with it as JSON, or nothing for `204`. A handler that throws answers 500 and fails the test after it ran, as a request that failed inside the fake tenant (likely a bug in the handler). To answer with an error on purpose, return a `Response` with that status.
- **The handler's input:** `body` is the parsed JSON, the text, or `undefined` for uploads (multipart or binary); `request` is a copy of the raw request whose body you can read (for example the bytes of an upload). `next()` can be called once per request.
- **`{ once: true }`** answers only the first match, for example a single temporary failure.
- **`next()`** passes the request on to the fake platform (or an older override) and returns its answer. Use it to add latency, to change an answer, or to let the platform store a write while your service sees an error. **`callCount`** is the number of requests this override got, this one included.

```ts
// fail the first request, answer the others normally
c8y.override('POST /alarm/alarms', ({ callCount, next }) => callCount === 1 ? Response.json({ message: 'Unavailable' }, { status: 503 }) : next())

// the platform stores the alarm, your service sees an error
c8y.override('POST /alarm/alarms', async ({ next }) => {
  await next()
  return new Response(null, { status: 503 })
})
```

Overrides couple a test to the endpoints your service calls. Use them for failures and for APIs the fake doesn't emulate, not for normal data.

By default, a request the fake can't answer **fails the test** after it ran, naming the request and the reason:

```
c8y-nitro/testing: 1 Cumulocity request(s) the fake tenant does not support:
  GET /features (endpoint not emulated)
```

Answer it with `c8y.override()`, or set `onUnhandledRequest: 'warn'` or `'ignore'` in the plugin options or with `c8y.apply()`.

## What the Fake Emulates

The fake tenant is a [fake-c8y](https://github.com/schplitt/fake-c8y) world: an in-memory Cumulocity platform whose endpoints, query parameters, required fields, and enum values come from the [official OpenAPI spec](https://cumulocity.com/api/core/), and whose behavior fake-c8y checks with contract scenarios against a real tenant. It emulates:

- inventory with the query language, text search, hierarchies, and cascading deletes; identity; binaries
- measurements (with series and generated history), events with attachments, alarms with deduplication, operations, bulk operations, and new device requests
- tenant options, retention rules, audit records, tenant statistics, and availability monitoring
- users, groups, global and inventory roles, applications, and microservice subscriptions
- Notification 2.0: subscriptions, tokens, and the consumer WebSocket of c8y-nitro's realtime client

The details, and where the fake simplifies, are in fake-c8y's [Emulated API](https://github.com/schplitt/fake-c8y/blob/main/docs/emulated-api.md) guide. Every verified place where the platform differs from its API docs is in its [Platform Behavior](https://github.com/schplitt/fake-c8y/blob/main/docs/platform-behavior.md) reference. A request for an endpoint the platform does not have (`GET /inventory/nope`) answers 404, and a known path with another method answers 405, like on the platform. A request the fake does not emulate answers 501 and fails the test (see above).

What c8y-nitro sets up on top:

- **IDs** have the platform's format (managed objects get 8 digits, `47100001`). They are deterministic: the same arrangement gives the same IDs in every test and every run. Timestamps come from `Date`, so `vi.useFakeTimers()` controls them.
- **Permissions** are checked like on the platform for users the tenant stores: a request your service sends with the credentials of a seeded user (for example the `as` caller of `serverFetch()`) gets 403 where that user lacks the rights, and lists show only what it may see. Your service's service users (`useSubscribedTenantClients()` and the like) have the `requiredRoles` of your manifest plus `ROLE_SYSTEM`, like on the platform: a request that needs a role the manifest does not list answers 403 `security/Forbidden`. That 403 does not fail the test by itself (it is not an unsupported request): your route sees the error, and `c8y.calls` shows the request with `status: 403` and the service user (`service_<tenant>`). Add the role to `requiredRoles` in your manifest. The default `user` and requests without credentials keep full access. `c8yTest({ roles: 'off' })` turns the checks off.
- **Manifest:** your manifest's `roles` exist in every subscribed tenant, and the `defaultValue`s of its `settings` are tenant options of your settings category (`c8y.tenantOptions.set()` or `c8y.tenantOptions.delete()` changes them for a test).
- **Tenant options:** `credentials.` options read as `<<Encrypted>>`, except in your microservice's own settings category, where the service gets the clear value.
- **Tenants:** each request is answered with the data of the tenant of its credentials. The `targetTenant` parameter is not read.
- **Applications:** every tenant has the platform's default applications (Administration, Cockpit, Device Management, and microservices such as `smartrule`, `apama-ctrl-mt`, and `report-agent`), subscribed like on a new tenant. Calls to these microservices (`/service/smartrule/**`) are not emulated: they are unsupported requests (501, the test fails by default), so answer them with `c8y.override('POST /service/smartrule/**', ...)`. A microservice the tenant does not have answers 404 `microservice/Not Found`, like on the platform. `c8y.seed({ defaultApplications: false })` removes the default applications.

If you find a difference from the real platform, please [open an issue in fake-c8y](https://github.com/schplitt/fake-c8y/issues).

## Debugging

Every request your service sent to the platform in the current test is recorded:

```ts
console.log(c8y.calls) // method, path, query, body, tenant, user
c8y.callsTo('GET /inventory/**')
expect(c8y).toHaveReceived('GET /tenant/options/**', { times: 1 })
```

Prefer asserting on responses and `c8y.db` over asserting on calls. Asserting on calls is useful where the request itself is the behavior, for example to check that a value is cached.

## Limitations

- **One app per test file.** [Module options](/reference/module-options) apply to the whole Nitro app. To test different options, use a separate [Vitest project](https://vitest.dev/guide/projects) with its own `nitro({ ... })` config.
- **No concurrent tests.** All tests of a file share the fake tenant, so `c8y` and `serverFetch(path, { as })` throw in concurrent tests: `it.concurrent`, `describe.concurrent`, and every test when `sequence.concurrent` is on. Vitest 5 has no `.sequential` modifier, so to run a file or `describe` sequentially under `sequence.concurrent`, pass `{ concurrent: false }`:

  ```ts
  describe('orders', { concurrent: false }, () => {
    // c8y works here
  })
  ```
- **Caches persist with the service instance.** Tests that share an instance share its caches (see [Service Instances](#service-instances)). A new instance clears c8y-nitro's caches, but not functions you cache with `defineCachedFunction`, and not module state of your own files.
- **Requests to other hosts are not faked.** `@c8y/client`, c8y-realtime, and plain `fetch` calls to the platform's URL (`C8Y_BASEURL`) go to the fake tenant.
