# Testing API

Reference for `c8y-nitro/testing` and `c8y-nitro/testing/vite`. See the [Testing guide](/guide/testing) for how to test a service, the scoping rules, and what the fake tenant emulates. The fake tenant is a [fake-c8y](https://github.com/schplitt/fake-c8y) world.

## `c8yTest(options?)`

```ts
import { c8yTest } from 'c8y-nitro/testing/vite'
```

Vite plugin. Add it next to `nitro()` in `vitest.config.ts`. `options` is the baseline of the fake tenant for every test:

| Option               | Type                            | Default                                | Description                                                                                                                              |
| -------------------- | ------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `tenant`             | `string`                        | `'t12345'`                             | Tenant the microservice is deployed in (`C8Y_BOOTSTRAP_TENANT`).                                                                         |
| `user`               | `C8yTestUser \| null`           | `{ userName: 'test-user', roles: [] }` | Default caller of `serverFetch()`, full access on the platform. `null`: `GET /user/currentUser` answers 401.                             |
| `subscriptions`      | `C8yTestSubscription[]`         | the deployed tenant                    | Subscribed tenants and their service users.                                                                                              |
| `tenantOptions`      | `Record<string, string>`        | `{}`                                   | Options of the own settings category in the deployed tenant.                                                                             |
| `onUnhandledRequest` | `'error' \| 'warn' \| 'ignore'` | `'error'`                              | What happens to platform requests the fake cannot answer.                                                                                |
| `baseUrl`            | `string`                        | `'https://t12345.cumulocity.test'`     | `C8Y_BASEURL` of the fake platform.                                                                                                      |
| `roles`              | `'enforce' \| 'off'`            | `'enforce'`                            | Permission checks for users seeded with `c8y.seed({ users })` and for service users (the manifest's `requiredRoles` plus `ROLE_SYSTEM`). |
| `service`            | `'per-test' \| 'per-file'`      | `'per-test'`                           | How long one service instance lives: a new one per test, or one per file.                                                                |

The plugin sets these environment variables unless `test.env` sets them: `C8Y_BASEURL`, `C8Y_BOOTSTRAP_TENANT`, `C8Y_BOOTSTRAP_USER`, `C8Y_BOOTSTRAP_PASSWORD`, `C8Y_DEVELOPMENT_TENANT`, `C8Y_DEVELOPMENT_USER`, `C8Y_DEVELOPMENT_PASSWORD`.

## `c8y`

```ts
import { c8y } from 'c8y-nitro/testing'
```

Arrange calls (marked _scoped_) apply to the scope they are called in: file, `describe`, or test. See [Scopes](/guide/testing#scopes).

### Arrange

| Member                                                                            | Description                                                                                                                                                                       |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `c8y.device(input?)`                                                              | _Scoped._ Creates a device (`c8y_IsDevice`). Returns a `C8yRef`.                                                                                                                  |
| `c8y.managedObject(input?)`                                                       | _Scoped._ Creates a managed object. Returns a `C8yRef`.                                                                                                                           |
| `c8y.binary({ name, content, contentType?, tenant? })`                            | _Scoped._ Creates an inventory binary (a file). Returns a `C8yRef`.                                                                                                               |
| `c8y.seed({ measurements?, events?, alarms?, operations?, users?, …, tenant? })`  | _Scoped._ Creates data other data does not point to, validated like API writes.                                                                                                   |
| `c8y.tenantOptions.set(key, value, scope?)`                                       | _Scoped._ Sets an option. `scope`: `{ category?, tenant? }`.                                                                                                                      |
| `c8y.tenantOptions.delete(key, scope?)`                                           | _Scoped._ Deletes an option.                                                                                                                                                      |
| `c8y.subscriptions.add(subscription)` / `.remove(tenant)` / `.set(subscriptions)` | _Scoped._ Changes the subscribed tenants.                                                                                                                                         |
| `c8y.override(pattern, handler, { once? })`                                       | _Scoped._ Overrides the platform's answer, for failures and unsupported APIs.                                                                                                     |
| `c8y.apply(state)`                                                                | _Scoped._ Applies a partial `C8yTestState`: `tenant`, `subscriptions`, `tenantOptions`, `onUnhandledRequest`.                                                                     |
| `c8y.startService()`                                                              | In `beforeAll`: the tests of that `describe` (or file) share one service. In `beforeEach`: a new service per test. In a test (`await` it): a new service now, on the test's data. |
| `c8y.stopService()`                                                               | In a test (`await` it): stops the service, so data written now reaches no service. `serverFetch()` throws until `c8y.startService()`. The next test gets a new service.           |

`c8y.device()` and `c8y.managedObject()` take any fragments plus:

| Field                             | Description                                              |
| --------------------------------- | -------------------------------------------------------- |
| `children`, `assets`, `additions` | Refs added as child devices, assets, or additions.       |
| `externalIds`                     | External IDs by type, e.g. `{ c8y_Serial: 'SN-1' }`.     |
| `owner`                           | Owner. Defaults to the current user.                     |
| `tenant`                          | Tenant to create it in. Defaults to the deployed tenant. |

Seed inputs reference managed objects as a ref, an id, or `{ id }`: `source` for measurements, events, and alarms, and `deviceId` for operations.

### Act

```ts
import { definePersona, serverFetch } from 'c8y-nitro/testing'
```

| Member                     | Description                                                                                                                                                                                                                                                                                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `serverFetch(path, init?)` | Calls a route of your service, like `serverFetch()` from `nitro`. `init.as` is the caller of this call only: a user the fake tenant stores (a name, or a user with `tenant` such as a persona), seeded with `c8y.seed({ users })`; the platform checks its roles. Throws for an unknown user. Without `as`, the default user of the plugin config calls. |
| `definePersona(user)`      | Types a user once, to seed it (`c8y.seed({ users: [persona] })`) and call as it (role names autocomplete).                                                                                                                                                                                                                                               |

### Assert

| Member                                                                            | Description                                                                                                                                                                 |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `c8y.db.managedObjects` / `.measurements` / `.events` / `.alarms` / `.operations` | `get(idOrRef)` and `find(filter?)`: the platform's data as the API would return it.                                                                                         |
| `c8y.db.operations.update(id, { status, failureReason? })`                        | Updates an operation like a device would.                                                                                                                                   |
| `c8y.db.externalIds.find(managedObject?)`                                         | External IDs, optionally of one managed object.                                                                                                                             |
| `c8y.db.binaries.get(id)` / `.find()` / `.content(id)`                            | Binaries, and their content (`name`, `contentType`, `bytes`, `text()`).                                                                                                     |
| `c8y.db.events.attachment(eventId)`                                               | An event's attachment (`name`, `contentType`, `bytes`, `text()`).                                                                                                           |
| `await c8y.notifications.settled({ timeout? })`                                   | Waits until every notification delivered to your service's realtime handlers is processed. Notifications of a subscription without a consumer are not waited for.           |
| `c8y.notifications.subscriptions()`                                               | Notification 2.0 subscriptions your service created.                                                                                                                        |
| `c8y.notifications.consumers(filter?)`                                            | Open listeners (consumer sockets) of your service. `filter`: `{ tenant?, subscription?, subscriber?, token? }`. Poll it for a listener opened later, then call `settled()`. |
| `c8y.db.users` / `.groups` / `.roles` / `.auditRecords` / `.retentionRules` / …   | The other collections of the fake platform, with `get()` and `find()`.                                                                                                      |
| `c8y.db.tenant(tenant)`                                                           | The same views for another tenant.                                                                                                                                          |
| `c8y.tenantOptions.get(key, scope?)`                                              | Current value of an option.                                                                                                                                                 |
| `c8y.subscriptions.list()`                                                        | Current subscriptions.                                                                                                                                                      |
| `c8y.tenant`                                                                      | Deployed tenant id.                                                                                                                                                         |
| `c8y.calls` / `c8y.callsTo(pattern)`                                              | Platform requests of the current test (for debugging and caching checks).                                                                                                   |
| `c8y.unhandled`                                                                   | Requests of the current test the fake could not answer, with `reason` and `kind`.                                                                                           |
| `expect(c8y).toHaveReceived(pattern, { times? })`                                 | Asserts a matching platform request was sent.                                                                                                                               |

## Override Patterns

`"[METHOD ]/path"`, for example `'GET /inventory/managedObjects/:id'`.

| Segment | Matches                                                   |
| ------- | --------------------------------------------------------- |
| `name`  | exactly `name`                                            |
| `:name` | any one segment, captured as `params.name`                |
| `*`     | any one segment                                           |
| `**`    | the rest of the path (also empty), captured as `params._` |

The handler receives the request: `method`, `path`, `params`, `query`, `body` (parsed JSON), `headers`, `tenant`, `user`, and `request` (a copy of the `Request` the service sent, with a readable body, e.g. the bytes of an upload), plus `callCount` (the requests this override got, this one included) and `next()` (answers the request as if the override did not exist and returns that `Response`; once per request). `body` is `undefined` for uploads. A handler that throws answers 500 and fails the test. Return a `Response` for full control, any other value to answer `200` with it as JSON, or nothing to answer `204`.

## Types

All types are exported from `c8y-nitro/testing`:

- **Plugin and state:** `C8yTestOptions`, `C8yTestState`, `C8yTestUser`, `C8yServerFetchInit`, `C8yCaller`, `C8yTestRole`, `C8yTestSubscription`, `C8yTenantOptionScope`, `ToHaveReceivedOptions`.
- **Data model:** `C8yRef`, `C8yIdInput`, `C8yManagedObjectInput`, `C8yBinaryInput`, `C8yBinaryContent`, `C8ySeed`, `C8yMeasurementInput`, `C8yMeasurementGeneratorInput`, `C8yEventInput`, `C8yAlarmInput`, `C8yOperationInput`, `C8yNewDeviceRequestInput`, `C8yRetentionRuleInput`, `C8yAuditRecordInput`, `C8yUserInput`, `C8yGroupInput`, `C8yInventoryRoleInput`, `C8yApplicationInput`.
- **Inspection:** `C8yDb`, `C8yDbCollection`, `C8yDbFilter`, `C8yNotificationSubscription`.
- **Requests:** `C8yRequest`, `C8yUnhandledRequest`, `C8yRequestContext`, `C8yRequestHandler`, `UnhandledRequestStrategy`.
- **Enums from the spec:** `C8yAlarmSeverity`, `C8yAlarmStatus`, `C8yOperationStatus`.
