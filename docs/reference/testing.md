# Testing API

Reference for `c8y-nitro/testing` and `c8y-nitro/testing/vite`. See the [Testing guide](/guide/testing) for how to test a service, the scoping rules, and what the fake tenant emulates.

## `c8yTest(options?)`

```ts
import { c8yTest } from 'c8y-nitro/testing/vite'
```

Vite plugin. Add it next to `nitro()` in `vitest.config.ts`. `options` is the baseline of the fake tenant for every test:

| Option               | Type                            | Default                                | Description                                                      |
| -------------------- | ------------------------------- | -------------------------------------- | ---------------------------------------------------------------- |
| `tenant`             | `string`                        | `'t12345'`                             | Tenant the microservice is deployed in (`C8Y_BOOTSTRAP_TENANT`). |
| `user`               | `C8yTestUser \| null`           | `{ userName: 'test-user', roles: [] }` | Default user for plain `serverFetch()`. `null`: not logged in.   |
| `subscriptions`      | `C8yTestSubscription[]`         | the deployed tenant                    | Subscribed tenants and their service users.                      |
| `tenantOptions`      | `Record<string, string>`        | `{}`                                   | Options of the own settings category in the deployed tenant.     |
| `onUnhandledRequest` | `'error' \| 'warn' \| 'ignore'` | `'error'`                              | What happens to platform requests the fake cannot answer.        |
| `baseUrl`            | `string`                        | `'https://t12345.cumulocity.test'`     | `C8Y_BASEURL` of the fake platform.                              |

The plugin sets these environment variables unless `test.env` sets them: `C8Y_BASEURL`, `C8Y_BOOTSTRAP_TENANT`, `C8Y_BOOTSTRAP_USER`, `C8Y_BOOTSTRAP_PASSWORD`, `C8Y_DEVELOPMENT_TENANT`, `C8Y_DEVELOPMENT_USER`, `C8Y_DEVELOPMENT_PASSWORD`.

## `c8y`

```ts
import { c8y } from 'c8y-nitro/testing'
```

Arrange calls (marked _scoped_) apply to the scope they are called in: file, `describe`, or test. See [Scopes](/guide/testing#scopes).

### Arrange

| Member                                                                            | Description                                                                                |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `c8y.device(input?)`                                                              | _Scoped._ Creates a device (`c8y_IsDevice`). Returns a `C8yRef`.                           |
| `c8y.managedObject(input?)`                                                       | _Scoped._ Creates a managed object. Returns a `C8yRef`.                                    |
| `c8y.seed({ measurements?, events?, alarms?, operations?, tenant? })`             | _Scoped._ Creates measurements, events, alarms, and operations, validated like API writes. |
| `c8y.tenantOptions.set(key, value, scope?)`                                       | _Scoped._ Sets an option. `scope`: `{ category?, tenant? }`.                               |
| `c8y.tenantOptions.delete(key, scope?)`                                           | _Scoped._ Deletes an option.                                                               |
| `c8y.subscriptions.add(subscription)` / `.remove(tenant)` / `.set(subscriptions)` | _Scoped._ Changes the subscribed tenants.                                                  |
| `c8y.override(pattern, handler, { once? })`                                       | _Scoped._ Overrides the platform's answer, for failures and unsupported APIs.              |
| `c8y.apply(state)`                                                                | _Scoped._ Applies a partial `C8yTestState` (the plugin options except `baseUrl`).          |

`c8y.device()` and `c8y.managedObject()` take any fragments plus:

| Field                             | Description                                              |
| --------------------------------- | -------------------------------------------------------- |
| `children`, `assets`, `additions` | Refs added as child devices, assets, or additions.       |
| `externalIds`                     | External IDs by type, e.g. `{ c8y_Serial: 'SN-1' }`.     |
| `owner`                           | Owner. Defaults to the current user.                     |
| `tenant`                          | Tenant to create it in. Defaults to the deployed tenant. |

Seed inputs reference managed objects as a ref, an id, or `{ id }`: `source` for measurements, events, and alarms, and `deviceId` for operations.

### Act

Call your service with `serverFetch()` from `nitro` (as the default user), or with a persona:

| Member                       | Description                                                       |
| ---------------------------- | ----------------------------------------------------------------- |
| `c8y.persona(user \| null)`  | Creates a persona. `null` is a caller without a valid login.      |
| `persona.fetch(path, init?)` | Calls a route of your service as that user, like `serverFetch()`. |

### Assert

| Member                                                                            | Description                                                                         |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `c8y.db.managedObjects` / `.measurements` / `.events` / `.alarms` / `.operations` | `get(idOrRef)` and `find(filter?)`: the platform's data as the API would return it. |
| `c8y.db.operations.update(id, { status, failureReason? })`                        | Updates an operation like a device would.                                           |
| `c8y.db.externalIds.find(managedObject?)`                                         | External IDs, optionally of one managed object.                                     |
| `c8y.db.tenant(tenant)`                                                           | The same views for another tenant.                                                  |
| `c8y.tenantOptions.get(key, scope?)`                                              | Current value of an option.                                                         |
| `c8y.subscriptions.list()`                                                        | Current subscriptions.                                                              |
| `c8y.tenant`                                                                      | Deployed tenant id.                                                                 |
| `c8y.calls` / `c8y.callsTo(pattern)`                                              | Platform requests of the current test (for debugging and caching checks).           |
| `c8y.unhandled`                                                                   | Requests of the current test the fake could not answer, with `reason`.              |
| `expect(c8y).toHaveReceived(pattern, { times? })`                                 | Asserts a matching platform request was sent.                                       |

## Override Patterns

`"[METHOD ]/path"`, for example `'GET /inventory/managedObjects/:id'`.

| Segment | Matches                                                   |
| ------- | --------------------------------------------------------- |
| `name`  | exactly `name`                                            |
| `:name` | any one segment, captured as `params.name`                |
| `*`     | any one segment                                           |
| `**`    | the rest of the path (also empty), captured as `params._` |

The handler receives the request: `method`, `path`, `params`, `query`, `body` (parsed JSON), `headers`, `tenant`, `user`, and the raw `request`. Return a `Response` for full control, any other value to answer `200` with it as JSON, or nothing to answer `204`.

## Types

All types are exported from `c8y-nitro/testing`:

- **Plugin and state:** `C8yTestOptions`, `C8yTestState`, `C8yTestUser`, `C8yPersona`, `C8yTestRole`, `C8yTestSubscription`.
- **Data model:** `C8yRef`, `C8yIdInput`, `C8yManagedObjectInput`, `C8ySeed`, `C8yMeasurementInput`, `C8yEventInput`, `C8yAlarmInput`, `C8yOperationInput`.
- **Inspection:** `C8yDb`, `C8yDbCollection`, `C8yDbFilter`.
- **Requests:** `C8yRequest`, `C8yUnhandledRequest`, `C8yRequestContext`, `C8yRequestHandler`, `UnhandledRequestStrategy`.
- **Enums from the spec:** `C8yAlarmSeverity`, `C8yAlarmStatus`, `C8yOperationStatus`.
