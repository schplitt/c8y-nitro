# Testing

`c8y-nitro/testing` lets you test your microservice against a fake Cumulocity tenant. Your service runs unchanged and uses the real `@c8y/client`. Its requests are answered by an in-memory tenant instead of the network.

A test works in three steps:

1. **Arrange** the platform as data: the user calling your service, devices, measurements, alarms, tenant options, and so on.
2. **Act**: call a route of your service with `serverFetch()` from `nitro`.
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

The tests seed the fake Cumulocity tenant with a pump and its measurements, call the service with `serverFetch()`, and check the result. `c8y` is only the fake platform; your service is called like any Nitro route:

```ts [test/pumps.test.ts]
import { serverFetch } from 'nitro'
import { describe, expect, it } from 'vitest'
import { c8y } from 'c8y-nitro/testing'

const pump = c8y.device({ name: 'Pump 1', externalIds: { c8y_Serial: 'SN-1' } })

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
    const visitor = c8y.persona({ userName: 'visitor', roles: [] })

    expect((await visitor.fetch('/pumps/SN-1/check', { method: 'POST' })).status).toBe(403)
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

### Measurements, Events, Alarms, and Operations

```ts
c8y.seed({
  measurements: [{ source: pump, type: 'c8y_Temperature', time: '2026-01-01T10:00:00Z', c8y_Temperature: { T: { value: 21.5, unit: 'C' } } }],
  events: [{ source: pump, type: 'c8y_DoorOpened' }],
  alarms: [{ source: pump, type: 'c8y_LowPressure', severity: 'MINOR' }],
  operations: [{ deviceId: pump, c8y_Restart: {} }],
})
```

Seeds get the same treatment as writes from your service:

- **Validation:** required fields, enum values such as alarm severities, and the source must exist.
- **Defaults:** `time` defaults to now, `text` to the type, and alarm `severity` to `MAJOR`.
- **Platform behavior:** alarms are deduplicated, and operations start as `PENDING`.

### Subscriptions and Tenant Options

```ts
c8y.subscriptions.add({ tenant: 't99999', user: 'service_t99999', password: 'pw' })
c8y.tenantOptions.set('maxTemperature', '100')
```

- **Service users** of the subscribed tenants are used by `useSubscribedTenantCredentials()`, `useDeployedTenantClient()`, and the other service clients. By default, the deployed tenant `t12345` is subscribed.
- **Data is kept per tenant.** Pass `tenant` to `c8y.device()`, `c8y.seed()`, or `c8y.tenantOptions.set()` to arrange data for another tenant.

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

Each request is answered with the data of the tenant it was sent to: the tenant of the credentials, or the `targetTenant` parameter. Personas can belong to any tenant (`c8y.persona({ ..., tenant: 't99999' })`), so you can also test what users of a subscribed tenant see.

## Personas

A persona is a user that calls your service. `persona.fetch()` calls a route as that user, so one test can compare different callers. Plain `serverFetch()` calls as the default `user` from the `c8yTest()` config.

```ts
const operator = c8y.persona({ userName: 'operator', roles: ['ROLE_ALARM_ADMIN'] })
const visitor = c8y.persona({ userName: 'visitor', roles: [] })
const partner = c8y.persona({ userName: 'eve', roles: ['ROLE_ALARM_ADMIN'], tenant: 't99999' })
const anonymous = c8y.persona(null) // no valid login

it('only lets operators run the check', async () => {
  expect((await operator.fetch('/pumps/SN-1/check', { method: 'POST' })).status).toBe(200)
  expect((await visitor.fetch('/pumps/SN-1/check', { method: 'POST' })).status).toBe(403)
})
```

The persona reaches your service the same way a real user does, through [dev user injection](/guide/dev-user). `useUser()`, `useUserRoles()`, the auth middleware, and `useUserClient()` see the persona. A persona belongs to the deployed tenant unless you set `tenant`. Role names autocomplete: your manifest's roles plus the known platform roles.

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

## Scopes

Arrange calls apply to the scope they are called in:

| Where You Call It                      | Applies To                                           |
| -------------------------------------- | ---------------------------------------------------- |
| `c8yTest({...})` in `vitest.config.ts` | every test of the project (the baseline)             |
| top level of a test file               | every test in the file                               |
| inside `describe`                      | every test in that `describe`, including nested ones |
| inside a test or `beforeEach`          | that test only                                       |

Before every test, the fake tenant is rebuilt: the baseline first, then the file, then each enclosing `describe` from outer to inner, then the test. Nothing a test does, including data your service writes, leaks into the next test. IDs come out the same in every run.

| API                                                 | Inner Scope                                    |
| --------------------------------------------------- | ---------------------------------------------- |
| `c8y.device()`, `c8y.managedObject()`, `c8y.seed()` | adds data                                      |
| `c8y.tenantOptions.set()` / `.delete()`             | changes one key                                |
| `c8y.subscriptions.add()` / `.remove()`             | changes one tenant; `.set([...])` replaces all |
| `c8y.override()`                                    | stacks: inner and newer overrides win          |

Arrange calls cannot be used in `beforeAll()` or `afterAll()`, because state is rebuilt before every test. Use file or `describe` level instead.

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
- **The handler's return value:** return a `Response` for any status, any other value for `200` with it as JSON, or nothing for `204`.
- **`{ once: true }`** answers only the first match, for example a single temporary failure.

Overrides couple a test to the endpoints your service calls. Use them for failures and for APIs the fake doesn't emulate, not for normal data.

By default, a request the fake can't answer **fails the test** after it ran, naming the request and the reason:

```
c8y-nitro/testing: 1 Cumulocity request(s) the fake tenant does not support:
  GET /tenant/statistics/summary (endpoint not emulated)
```

Answer it with `c8y.override()`, or set `onUnhandledRequest: 'warn'` or `'ignore'` in the plugin options or with `c8y.apply()`.

## What the Fake Emulates

The fake implements a documented subset of the Cumulocity REST API. Request and response formats, query parameters, required fields, and enum values come from the [official OpenAPI spec](https://cumulocity.com/api/core/). The behavior is checked by contract scenarios.

| API                          | Emulated                                                                                                                                                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current user, current tenant | from the calling persona and the request's credentials                                                                                                                                                                                                                          |
| Microservice subscriptions   | from `c8y.subscriptions`                                                                                                                                                                                                                                                        |
| Tenant options               | read, write, delete, and list per category and tenant                                                                                                                                                                                                                           |
| Inventory                    | create, read, update (fragments merge, `null` removes), delete; list by `type`, `fragmentType`, `ids`, `owner`, `text`, `childDeviceId`/`childAssetId`/`childAdditionId`, `onlyRoots`, and `query`/`q` (see below); child devices, assets, and additions with parent references |
| Identity                     | external IDs: create, read, delete, list per managed object                                                                                                                                                                                                                     |
| Measurements                 | create (single or collection), read, delete, list by `source`, `type`, `valueFragmentType`/`valueFragmentSeries`, `dateFrom`/`dateTo`, `revert`                                                                                                                                 |
| Events                       | create, read, update, delete, list by `source`, `type`, `fragmentType`, date ranges, `revert`                                                                                                                                                                                   |
| Alarms                       | create (with deduplication), read, update, bulk update, list by `source`, `type`, `status`, `severity`, `resolved`, date ranges                                                                                                                                                 |
| Operations                   | create, read, update, list by `deviceId`, `status`, `fragmentType`, date range, `revert`                                                                                                                                                                                        |

All lists support `pageSize`, `currentPage`, `withTotalPages`, and `withTotalElements`, with `next` and `prev` links. Inventory queries (`query` and `q`) support the documented [query language](https://cumulocity.com/api/core/#section/Query-language):

- `eq`, `gt`, `ge`, `lt`, `le`, `and`, `or`, `not()`, parentheses, and `$orderby`
- `has()`, `hasany()`, `bygroupid()`, and `isinhierarchyof()`
- values: strings, `*` wildcards, integers, decimals with an `f`/`d` suffix, `null`, and date-times with `.date`
- `eq` on array properties and on objects in arrays

These details behave like the platform, checked against a real tenant: exact matches are case-sensitive, wildcards case-insensitive, decimals without a suffix are compared as strings, `type` is ignored when a query is given, and anything outside the language (such as `ne`) is rejected with 422.

**Not emulated:** `withLatestValues`, `withGroups`, `withSourceAssets` and similar `withSource*` parameters, cascade deletes, measurement series, binaries, bulk operations, real-time notifications, and all other APIs. These fail loudly instead of returning wrong results. Unknown query parameters are ignored, as on the platform.

**Assumptions:** where the spec doesn't define behavior, the fake assumes the following:

- **IDs** are sequential numbers, starting at `1` in every test. Timestamps come from `Date`, so `vi.useFakeTimers()` controls them.
- **`owner`** is the calling user.
- **Groups:** `bygroupid()` matches the group's direct child assets. `isinhierarchyof()` follows child assets, devices, and additions recursively.
- **Paging:** pages are 1-based, the default page size is 5, and `next` is present when a page is full.
- **Sort orders** (from the spec): measurements oldest first, events and alarms newest first, operations by ascending ID, inventory by ID. `revert` flips the order where the spec allows it.
- **Date ranges:** the `…From` end is inclusive, the `…To` end is exclusive.
- **Alarm deduplication:** an `ACTIVE` or `ACKNOWLEDGED` alarm with the same source and type increments `count` and updates `time`.
- **Operations** start as `PENDING`. Only your tests change their status.
- **Validation:** writes that reference a missing source or device fail with 422.
- **Deleting a managed object** removes its references and external IDs. Its measurements, events, alarms, and operations stay.
- **Tenant options:** default values from your manifest's settings are not applied. Set the options your test needs.
- **No permission checks:** roles only matter in your own middleware, like `hasUserRequiredRole()`.

If you find a difference from the real platform, please [open an issue](https://github.com/schplitt/c8y-nitro/issues).

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
- **No concurrent tests.** All tests of a file share the fake tenant, so `c8y` throws in `it.concurrent` and `describe.concurrent`.
- **Your own caches persist within a file.** c8y-nitro clears its own caches before every test, but functions you cache with `defineCachedFunction` keep their entries.
- **Only `@c8y/client` is faked.** Requests sent with plain `fetch` are not intercepted.
