import { Buffer } from 'node:buffer'
import type { C8YTenantOptionKey } from 'c8y-nitro/types'
import { serverFetch as nitroServerFetch } from 'nitro'
import type { C8yRequest, C8yRequestHandler, C8yTestState, C8yTestSubscription, C8yTestUser, C8yUnhandledRequest } from './types'
import type { C8yDb, C8yManagedObjectInput, C8yRef, C8ySeed } from './data'
import { applySeed, createDb, createFromInput, newRef } from './data'
import { platform } from './platform'
import { compileRoute, matchRoute, splitPath } from './router'
import { DEFAULTS } from './defaults'
import { arrange, assertActiveTest } from './scope'

export type * from './types'
export type { C8yAlarmInput, C8yDb, C8yDbCollection, C8yDbFilter, C8yEventInput, C8yIdInput, C8yManagedObjectInput, C8yMeasurementInput, C8yOperationInput, C8yRef, C8ySeed } from './data'
export type { C8yAlarmSeverity, C8yAlarmStatus, C8yOperationStatus } from './capabilities.generated'

type TenantOptionKeyInput = C8YTenantOptionKey | (string & {})

/**
 * Where a tenant option lives. Defaults: own settings category, deployed tenant.
 */
export interface C8yTenantOptionScope {
  category?: string
  tenant?: string
}

/**
 * Options of the `toHaveReceived()` matcher.
 */
export interface ToHaveReceivedOptions {
  /**
   * Exact number of matching requests. Default: at least one.
   */
  times?: number
}

declare module 'vitest' {
  // Vitest 5: R is the matcher's return type, T the type of the received value.
  // eslint-disable-next-line unused-imports/no-unused-vars
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> {
    /**
     * Asserts that the microservice sent a matching request to the fake
     * Cumulocity platform in this test. Use it on `c8y`.
     *
     * @example
     * ```ts
     * expect(c8y).toHaveReceived('PUT /tenant/options/**')
     * expect(c8y).toHaveReceived('GET /inventory/managedObjects/42', { times: 1 })
     * ```
     */
    toHaveReceived: (pattern: string, options?: ToHaveReceivedOptions) => R
  }
}

/**
 * The fake Cumulocity tenant your microservice talks to in tests. Requires the
 * `c8yTest()` plugin from `c8y-nitro/testing/vite`.
 *
 * Arrange calls are **scope-aware**: at the top of a file they apply to every
 * test in the file, inside `describe` to the tests of that `describe` (inner
 * scopes override outer ones), and inside a test only to that test. Before
 * every test the tenant is rebuilt from the plugin baseline, the call log is
 * cleared, and c8y-nitro's caches are invalidated, so tests are independent.
 *
 * Arrange the platform as data: users, subscriptions, tenant options,
 * managed objects (`device()`), and measurements, events, alarms, and
 * operations (`seed()`). Your service reads and writes them through the real
 * `@c8y/client`; assert on its responses and on `c8y.db`.
 *
 * @example
 * ```ts
 * import { c8y, definePersona, serverFetch } from 'c8y-nitro/testing'
 *
 * const pump = c8y.device({ name: 'Pump', externalIds: { c8y_Serial: 'SN-1' } })  // seed the platform
 * const visitor = definePersona({ userName: 'visitor', roles: [] })
 *
 * it('returns the pump', async () => {
 *   expect((await serverFetch('/pumps/SN-1')).status).toBe(200)                  // as the default user
 *   expect((await serverFetch('/pumps/SN-1', { as: visitor })).status).toBe(403) // as another user
 * })
 * ```
 */
export const c8y = {
  /**
   * Tenant the microservice is deployed in (the bootstrap tenant).
   */
  get tenant(): string {
    return platform.tenant
  },

  /**
   * Every request the microservice sent to the platform in this test, in order.
   */
  get calls(): readonly C8yRequest[] {
    return platform.calls
  },

  /**
   * Requests in this test the fake tenant could not answer (not emulated, and
   * no `override()`). With the default `onUnhandledRequest: 'error'`, the test
   * fails after it ran if this is not empty.
   */
  get unhandled(): readonly C8yUnhandledRequest[] {
    return platform.unhandled
  },

  /**
   * The fake tenant's data, to assert on what your service wrote (and to
   * drive operation status like a device would).
   *
   * @example
   * ```ts
   * expect(c8y.db.alarms.find({ source: pump, type: 'overdue' })).toMatchObject([{ severity: 'MAJOR' }])
   * c8y.db.operations.update(operationId, { status: 'SUCCESSFUL' })
   * ```
   */
  db: {
    ...createDb(() => platform.tenant),
    tenant: (tenant: string) => createDb(() => tenant),
  } as C8yDb,

  /**
   * Creates a managed object in the fake tenant (in the current scope).
   * Returns a ref whose `id` is available while a test runs.
   *
   * @example
   * ```ts
   * const gateway = c8y.managedObject({ name: 'Gateway', type: 'c8y_Gateway', children: [c8y.device({ name: 'Pump' })] })
   * ```
   * @param input - Fragments, plus `children`/`assets`/`additions`, `externalIds`, and `tenant`
   */
  managedObject(input: C8yManagedObjectInput = {}): C8yRef {
    const ref = newRef(`c8y.managedObject(${JSON.stringify(input.name ?? input.type ?? '')})`)
    arrange('c8y.managedObject()', () => createFromInput(ref, input))
    return ref
  },

  /**
   * Creates a device (a managed object with `c8y_IsDevice`) in the fake tenant.
   *
   * @example
   * ```ts
   * const pump = c8y.device({ name: 'Pump', externalIds: { c8y_Serial: 'SN-1' } })
   * it('…', async () => {
   *   await serverFetch(`/devices/${pump.id}`)
   * })
   * ```
   * @param input - Fragments, plus `children`/`assets`/`additions`, `externalIds`, and `tenant`
   */
  device(input: C8yManagedObjectInput = {}): C8yRef {
    const ref = newRef(`c8y.device(${JSON.stringify(input.name ?? '')})`)
    arrange('c8y.device()', () => createFromInput(ref, { c8y_IsDevice: {}, ...input }))
    return ref
  },

  /**
   * Seeds measurements, events, alarms, and operations (in the current scope).
   * They are validated like API writes (required fields, enums, existing
   * source), and alarms are deduplicated like on the platform.
   *
   * @example
   * ```ts
   * c8y.seed({
   *   measurements: [{ source: pump, type: 'c8y_Temperature', c8y_Temperature: { T: { value: 21.5, unit: 'C' } } }],
   *   alarms: [{ source: pump, type: 'c8y_Overheating', severity: 'CRITICAL' }],
   * })
   * ```
   * @param seed - Data to seed
   */
  seed(seed: C8ySeed): void {
    arrange('c8y.seed()', () => applySeed(seed))
  },

  /**
   * Tenants subscribed to the microservice and their service users.
   */
  subscriptions: {
    /**
     * Current subscriptions.
     */
    list(): readonly C8yTestSubscription[] {
      return platform.subscriptions
    },
    /**
     * Adds a subscription, or replaces the one of the same tenant.
     * @param subscription - Tenant and service user credentials
     */
    add(subscription: C8yTestSubscription): void {
      arrange('c8y.subscriptions.add()', () => {
        platform.subscriptions = [...platform.subscriptions.filter((item) => item.tenant !== subscription.tenant), { ...subscription }]
      })
    },
    /**
     * Removes the subscription of a tenant.
     * @param tenant - Tenant id
     */
    remove(tenant: string): void {
      arrange('c8y.subscriptions.remove()', () => {
        platform.subscriptions = platform.subscriptions.filter((item) => item.tenant !== tenant)
      })
    },
    /**
     * Replaces all subscriptions.
     * @param subscriptions - The new subscriptions
     */
    set(subscriptions: C8yTestSubscription[]): void {
      arrange('c8y.subscriptions.set()', () => {
        platform.subscriptions = subscriptions.map((subscription) => ({ ...subscription }))
      })
    },
  },

  /**
   * Tenant options stored in the fake platform. These are platform values, not
   * caches: a cached read keeps its value until it expires or is invalidated.
   */
  tenantOptions: {
    /**
     * Sets an option value (merged with the outer scope's options).
     * @param key - Option key
     * @param value - Option value
     * @param scope - Category and tenant, default own category in the deployed tenant
     */
    set(key: TenantOptionKeyInput, value: string, scope?: C8yTenantOptionScope): void {
      arrange('c8y.tenantOptions.set()', () => platform.setOption(key, value, scope))
    },
    /**
     * Deletes an option in this scope.
     * @param key - Option key
     * @param scope - Category and tenant
     */
    delete(key: TenantOptionKeyInput, scope?: C8yTenantOptionScope): void {
      arrange('c8y.tenantOptions.delete()', () => {
        platform.deleteOption(key, scope)
      })
    },
    /**
     * Reads an option value from the platform.
     * @param key - Option key
     * @param scope - Category and tenant
     */
    get(key: TenantOptionKeyInput, scope?: C8yTenantOptionScope): string | undefined {
      return platform.getOption(key, scope)
    },
  },

  /**
   * Overrides the platform's answer for requests matching `pattern`. Use it
   * for failures (errors, timeouts) and for APIs the fake tenant does not
   * emulate; arrange normal data with `device()`/`seed()` instead, so tests do
   * not depend on which endpoints your service calls. Overrides stack: inner
   * scopes and newer overrides win over everything else.
   *
   * Patterns are `"[METHOD ]/path"` with `:param`, `*` (one segment), and `**`
   * (rest of the path).
   *
   * @example
   * ```ts
   * c8y.override('GET /inventory/**', () => Response.json({ message: 'Unavailable' }, { status: 503 }))
   * c8y.override('GET /tenant/statistics/summary', () => ({ deviceCount: 3 }))
   * ```
   * @param pattern - Route pattern
   * @param handler - Returns a `Response`, a JSON value (`200`), or nothing (`204`)
   * @param options - Handler options
   * @param options.once - Answer only the first matching request
   */
  override(pattern: string, handler: C8yRequestHandler, options: { once?: boolean } = {}): void {
    arrange('c8y.override()', () => {
      platform.override(pattern, handler, options.once ?? false)
    })
  },

  /**
   * Applies several arrange settings at once, in the current scope. Callers
   * are not part of the state: use `serverFetch(path, { as })`.
   * @param state - Partial tenant state
   */
  apply(state: Partial<Omit<C8yTestState, 'user'>>): void {
    arrange('c8y.apply()', () => platform.apply(state))
  },

  /**
   * Recorded requests matching a route pattern (same syntax as `override()`).
   * @param pattern - Route pattern, e.g. `'GET /tenant/options/**'`
   */
  callsTo(pattern: string): C8yRequest[] {
    const route = compileRoute(pattern)
    return platform.calls.filter((call) => matchRoute(route, call.method, splitPath(call.path)))
  },

}

/**
 * Request options of `serverFetch()`: Nitro's options plus `as`.
 */
export type C8yServerFetchInit = NonNullable<Parameters<typeof nitroServerFetch>[1]> & {
  /**
   * The user calling the route, e.g. a persona from `definePersona()` or an
   * inline user. `null` is a caller without a valid login. Without `as`, the
   * default `user` from the `c8yTest()` config calls.
   */
  as?: C8yTestUser | null
}

/**
 * Types a user that calls your service in tests, so it can be defined once
 * and reused (role names autocomplete). Pass it to `serverFetch(path, { as })`.
 *
 * @example
 * ```ts
 * const operator = definePersona({ userName: 'operator', roles: ['ROLE_ALARM_ADMIN'] })
 * const partner = definePersona({ userName: 'eve', roles: [], tenant: 't99999' })
 * ```
 * @param user - The user
 */
export function definePersona(user: C8yTestUser): C8yTestUser {
  return user
}

/**
 * Calls a route of your service, like `serverFetch()` from `nitro`. With
 * `as`, the request is sent as that user: the platform answers
 * `GET /user/currentUser` with it during the request.
 *
 * @example
 * ```ts
 * await serverFetch('/pumps/SN-1')                                           // default user
 * await serverFetch('/pumps/SN-1/check', { method: 'POST', as: operator })   // a persona
 * await serverFetch('/pumps/SN-1', { as: { userName: 'visitor', roles: [] } }) // inline
 * await serverFetch('/user', { as: null })                                   // not logged in
 * ```
 * @param path - Route path, including the query
 * @param init - Request options, plus `as`
 */
export async function serverFetch(path: string, init: C8yServerFetchInit = {}): Promise<Response> {
  if (!('as' in init)) {
    return nitroServerFetch(path, init)
  }
  const { as: user, ...requestInit } = init
  assertActiveTest('serverFetch({ as })')
  const previous = platform.user
  platform.setUser(user ?? null)
  try {
    const headers = new Headers(requestInit.headers)
    const login = user
      ? `${user.tenant ?? platform.tenant}/${user.userName}:${DEFAULTS.developmentPassword}`
      : `${platform.tenant}/anonymous:invalid`
    headers.set('authorization', `Basic ${Buffer.from(login).toString('base64')}`)
    return await nitroServerFetch(path, { ...requestInit, headers })
  } finally {
    platform.setUser(previous)
  }
}
