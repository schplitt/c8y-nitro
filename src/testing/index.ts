import type { C8YTenantOptionKey } from 'c8y-nitro/types'
import { serverFetch as nitroServerFetch } from 'nitro'
import { TestRunner } from 'vitest'
import type { C8yBinaryInput, C8yDb, C8yManagedObjectInput, C8yRequest, C8ySeed, C8yTenantOptionScope, C8yUnhandledRequest, NotificationSubscription, Realtime, RealtimeConsumer } from 'fake-c8y'
import { basicAuth, matchesCall } from 'fake-c8y'
import { SettleTimeoutError } from 'fake-c8y/realtime'
import type { C8yRequestHandler, C8yTestState, C8yTestSubscription, C8yTestUser } from './types'
import { arrange, assertActiveTest, isCollecting, isConcurrentRunning, isTestEnded, runningSuite } from './scope'
import { applyState, isServiceStopped, refs, restartService, shareService, stopServiceInTest, testCalls, testUnhandled, useWorld } from './world'

export type * from './types'
export type { C8yAlarmInput, C8yAlarmSeverity, C8yAlarmStatus, C8yApplicationInput, C8yAuditRecordInput, C8yBinaryContent, C8yBinaryInput, C8yDb, C8yDbCollection, C8yDbFilter, C8yEventInput, C8yGroupInput, C8yIdInput, C8yInventoryRoleInput, C8yManagedObjectInput, C8yMeasurementGeneratorInput, C8yMeasurementInput, C8yNewDeviceRequestInput, C8yOperationInput, C8yOperationStatus, C8yRequest, C8yRetentionRuleInput, C8ySeed, C8yTenantOptionScope, C8yUnhandledRequest, C8yUserInput } from 'fake-c8y'
export type { NotificationSubscription as C8yNotificationSubscription } from 'fake-c8y'

/**
 * A managed object or binary created by `c8y.device()`, `c8y.managedObject()`,
 * or `c8y.binary()`. Its `id` exists while a test runs (the object is rebuilt
 * before every test).
 */
export interface C8yRef {
  readonly id: string
}

class Ref implements C8yRef {
  private readonly label: string

  constructor(label: string) {
    this.label = label
  }

  get id(): string {
    const id = refs.get(this)
    if (id === undefined) {
      throw new Error(`${this.label} does not exist yet: objects created with c8y.device()/c8y.managedObject()/c8y.binary() exist while a test runs, in the scope they were created in.`)
    }
    return id
  }

  toJSON() {
    return { id: this.id }
  }
}

type TenantOptionKeyInput = C8YTenantOptionKey | (string & {})

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
 * every test the tenant is rebuilt from the plugin baseline and the call log
 * is cleared, so tests are independent. Your service keeps running between
 * tests that share an instance, with its caches (see `c8y.startService()`).
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
    return useWorld().tenant
  },

  /**
   * Every request the microservice sent to the platform in this test, in order.
   */
  get calls(): readonly C8yRequest[] {
    return testCalls()
  },

  /**
   * Requests in this test the fake tenant could not answer (not emulated, and
   * no `override()`). With the default `onUnhandledRequest: 'error'`, the test
   * fails after it ran if this is not empty.
   */
  get unhandled(): readonly C8yUnhandledRequest[] {
    return testUnhandled()
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
  get db(): C8yDb {
    return useWorld().db
  },

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
    const ref = new Ref(`c8y.managedObject(${JSON.stringify(input.name ?? input.type ?? '')})`)
    arrange('c8y.managedObject()', () => {
      refs.set(ref, useWorld().managedObject(input))
    })
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
    const ref = new Ref(`c8y.device(${JSON.stringify(input.name ?? '')})`)
    arrange('c8y.device()', () => {
      refs.set(ref, useWorld().device(input))
    })
    return ref
  },

  /**
   * Creates an inventory binary (a file) in the fake tenant (in the current
   * scope). Returns a ref whose `id` is available while a test runs.
   *
   * @example
   * ```ts
   * const manual = c8y.binary({ name: 'manual.txt', content: 'Turn it off and on again.' })
   * ```
   * @param input - Name, content, optional content type, tenant, and fragments
   */
  binary(input: C8yBinaryInput): C8yRef {
    const ref = new Ref(`c8y.binary(${JSON.stringify(input.name)})`)
    arrange('c8y.binary()', () => {
      refs.set(ref, useWorld().binary(input))
    })
    return ref
  },

  /**
   * Seeds everything other data does not point to (in the current scope):
   * measurements (also generated history), events, alarms, operations, new
   * device requests, retention rules, audit records, users, groups, roles,
   * inventory roles, and applications. They are validated like API writes
   * (required fields, enums, existing source), and alarms are deduplicated
   * like on the platform.
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
    arrange('c8y.seed()', () => {
      useWorld().seed(seed)
    })
  },

  /**
   * Tenants subscribed to the microservice and their service users.
   */
  subscriptions: {
    /**
     * Current subscriptions.
     */
    list(): readonly C8yTestSubscription[] {
      return useWorld().subscriptions
    },
    /**
     * Adds a subscription, or replaces the one of the same tenant.
     * @param subscription - Tenant and service user credentials
     */
    add(subscription: C8yTestSubscription): void {
      arrange('c8y.subscriptions.add()', () => {
        const world = useWorld()
        world.apply({ subscriptions: [...world.subscriptions.filter((item) => item.tenant !== subscription.tenant), { ...subscription }] })
      })
    },
    /**
     * Removes the subscription of a tenant.
     * @param tenant - Tenant id
     */
    remove(tenant: string): void {
      arrange('c8y.subscriptions.remove()', () => {
        const world = useWorld()
        world.apply({ subscriptions: world.subscriptions.filter((item) => item.tenant !== tenant) })
      })
    },
    /**
     * Replaces all subscriptions.
     * @param subscriptions - The new subscriptions
     */
    set(subscriptions: C8yTestSubscription[]): void {
      arrange('c8y.subscriptions.set()', () => {
        useWorld().apply({ subscriptions: subscriptions.map((subscription) => ({ ...subscription })) })
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
      arrange('c8y.tenantOptions.set()', () => {
        useWorld().options.set(key, value, scope)
      })
    },
    /**
     * Deletes an option in this scope.
     * @param key - Option key
     * @param scope - Category and tenant
     */
    delete(key: TenantOptionKeyInput, scope?: C8yTenantOptionScope): void {
      arrange('c8y.tenantOptions.delete()', () => {
        useWorld().options.delete(key, scope)
      })
    },
    /**
     * Reads an option value from the platform.
     * @param key - Option key
     * @param scope - Category and tenant
     */
    get(key: TenantOptionKeyInput, scope?: C8yTenantOptionScope): string | undefined {
      return useWorld().options.get(key, scope)
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
      const once = options.once ?? false
      useWorld().override(pattern, (request, ctx) => {
        if (once && ctx.callCount > 1) {
          return ctx.next()
        }
        const { method, path, query, body, headers } = ctx.call
        return handler({
          method,
          path,
          query,
          body,
          headers,
          tenant: ctx.tenant,
          user: ctx.user,
          params: ctx.params,
          request,
          callCount: ctx.callCount,
          next: ctx.next,
        })
      })
    })
  },

  /**
   * Starts an instance of your service (a new Nitro app: plugins run, c8y-nitro's
   * caches and realtime clients start empty). By default every test gets its
   * own (`c8yTest({ service: 'per-test' })`); use Vitest's hooks for the scope:
   *
   * - In `beforeAll` (file level or a `describe`): one instance for the tests of
   *   that scope, started before its first test on the data arranged down to
   *   that scope. Caches carry over between its tests, like on a running service.
   * - In `beforeEach`: a new instance for every test of the scope (e.g. inside a
   *   scope that shares one).
   * - Inside a test: a new instance now, on what the test arranged so far.
   *
   * @example
   * ```ts
   * describe('caching', () => {
   *   beforeAll(() => c8y.startService()) // one service for these tests
   *   it('reads the option once', async () => {})
   * })
   *
   * it('boots with the new subscription', async () => {
   *   c8y.subscriptions.add({ tenant: 't2', user: 'service_t2', password: 'pw' })
   *   await c8y.startService()
   * })
   * ```
   */
  startService(): Promise<void> {
    if (isCollecting()) {
      return Promise.reject(new Error('c8y.startService() cannot be called while Vitest collects tests. Call it in beforeAll() (one service for a describe or the file), beforeEach() (one per test), or inside a test.'))
    }
    if (TestRunner.getCurrentTest() === undefined && !isConcurrentRunning()) {
      // a beforeAll: the running suite shares one instance
      const suite = runningSuite() as { tasks?: Array<{ result?: unknown }> } | undefined
      if (!suite) {
        return Promise.reject(new Error('c8y.startService(): no running Vitest suite found. Call it in beforeAll(), beforeEach(), or inside a test.'))
      }
      if (suite.tasks?.some((task) => task.result !== undefined)) {
        return Promise.reject(new Error('c8y.startService() cannot be called in afterAll(): the tests of the scope already ran. Call it in beforeAll(), beforeEach(), or inside a test.'))
      }
      shareService(suite)
      return Promise.resolve()
    }
    assertActiveTest('c8y.startService()', 'in beforeAll(), beforeEach(), or inside a test')
    return restartService()
  },

  /**
   * Stops your service inside a test, without starting a new one: Nitro's
   * `close` hook runs, its realtime clients close, and its jobs stop. Data the
   * test writes now reaches no service, and `serverFetch()` from
   * `c8y-nitro/testing` throws (Nitro's own `serverFetch()` is not guarded).
   * `await c8y.startService()` starts a new instance, which catches up on what
   * it missed (a persistent subscription keeps what was written while no
   * client listened). Requests the fake cannot answer while the service
   * stops fail the test with `onUnhandledRequest: 'error'`. A second stop
   * does nothing, and the next test gets a new service. In a `beforeEach`,
   * the test runs on a stopped service. After the test function ended
   * (`afterEach`, `onTestFinished`, fixture teardown), in `beforeAll`, or in
   * `afterAll` it throws.
   *
   * @example
   * ```ts
   * // your realtime handler pushes every temperature it processes to this array
   * // (in a module of its own: importing a plugin file from a test fails)
   * import { handledTemperatures as handled } from '../server/handled-temperatures'
   *
   * const pump = c8y.device({ name: 'Pump 1' })
   * const temperature = (value: number) => ({ source: pump, type: 'c8y_Temperature', c8y_Temperature: { T: { value, unit: 'C' } } })
   *
   * it('catches up after an outage, in order', async () => {
   *   handled.length = 0
   *   c8y.seed({ measurements: [temperature(91)] })
   *   await c8y.notifications.settled()
   *
   *   await c8y.stopService()
   *   c8y.seed({ measurements: [temperature(92), temperature(93)] }) // nobody listens
   *
   *   await c8y.startService()
   *   await c8y.notifications.settled()
   *   expect(handled).toEqual([91, 92, 93])
   * })
   * ```
   */
  async stopService(): Promise<void> {
    if (isCollecting()) {
      throw new Error('c8y.stopService() cannot be called while Vitest collects tests. Call it inside a test.')
    }
    assertActiveTest('c8y.stopService()', 'inside a test')
    if (isTestEnded()) {
      throw new Error('c8y.stopService() cannot be used after the test function ended (afterEach(), onTestFinished(), fixture teardown). Call it inside a test.')
    }
    await stopServiceInTest()
  },

  /**
   * Applies several arrange settings at once, in the current scope. Callers
   * are not part of the state: use `serverFetch(path, { as })`.
   * @param state - Partial tenant state
   */
  apply(state: Partial<Omit<C8yTestState, 'user'>>): void {
    arrange('c8y.apply()', () => {
      applyState(state)
    })
  },

  /**
   * Notification 2.0 (realtime) in the fake tenant. Writes from your service,
   * `c8y.seed()`/`c8y.device()` inside a test, and `c8y.db.operations.update()`
   * are published to the subscriptions your service created.
   */
  notifications: {
    /**
     * Waits until every notification delivered to your service's realtime
     * handlers has been processed (acknowledged), including notifications
     * caused by the handlers' own writes. Notifications of a subscription
     * without a consumer are not waited for.
     *
     * @example
     * ```ts
     * c8y.seed({ measurements: [{ source: pump, type: 'c8y_Temperature', c8y_Temperature: { T: { value: 95, unit: 'C' } } }] })
     * await c8y.notifications.settled()
     * expect(c8y.db.alarms.find({ source: pump })).toHaveLength(1)
     * ```
     * @param options - Options
     * @param options.timeout - Milliseconds to wait before failing (default 5000)
     */
    async settled(options: { timeout?: number } = {}): Promise<void> {
      const timeout = options.timeout ?? 5000
      try {
        await useWorld().realtime.settled({ timeout })
      } catch (error) {
        if (error instanceof SettleTimeoutError) {
          const open = Object.entries(error.status).filter(([, count]) => count > 0).map(([field, count]) => `${field} ${count}`)
          throw new Error(`c8y.notifications.settled(): notifications still not processed after ${timeout} ms (${open.join(', ') || 'nothing open at the last check'})`, { cause: error })
        }
        throw error
      }
    },

    /**
     * Notification 2.0 subscriptions your service created (all tenants).
     */
    subscriptions(): readonly NotificationSubscription[] {
      return useWorld().realtime.subscriptions
    },

    /**
     * The open consumer sockets (listeners) of your service, one entry per
     * socket (sockets still connecting are not listed). `settled()` waits
     * only for work it can see: for a listener your service opens later
     * (a lazy route, its own timer, a reconnect after a drop), poll until it
     * is open, then call `settled()`.
     *
     * @example
     * ```ts
     * // count first: listeners opened at startup are listed too
     * const before = c8y.notifications.consumers({ tenant: 't12345' }).length
     * await serverFetch('/alarms/listen', { method: 'POST' }) // opens a listener lazily
     * await expect.poll(() => c8y.notifications.consumers({ tenant: 't12345' }).length).toBe(before + 1)
     * c8y.seed({ alarms: [{ source: pump, type: 'c8y_Test', text: 'Test', severity: 'MINOR' }] })
     * await c8y.notifications.settled()
     * ```
     * @param filter - Only sockets of this tenant, subscription, subscriber, or token
     */
    consumers(filter?: Parameters<Realtime['consumers']>[0]): RealtimeConsumer[] {
      return useWorld().realtime.consumers(filter)
    },
  },

  /**
   * Recorded requests matching a route pattern (same syntax as `override()`).
   * @param pattern - Route pattern, e.g. `'GET /tenant/options/**'`
   */
  callsTo(pattern: string): C8yRequest[] {
    return testCalls().filter((call) => matchesCall(pattern, call))
  },

}

/**
 * A user the fake tenant stores: its name (in the deployed tenant), or a user
 * with its `tenant`, e.g. a persona from `definePersona()`.
 */
export type C8yCaller = string | { userName: string, tenant?: string }

/**
 * Request options of `serverFetch()`: Nitro's options plus `as`.
 */
export type C8yServerFetchInit = NonNullable<Parameters<typeof nitroServerFetch>[1]> & {
  /**
   * The user making this call: a seeded user (`c8y.seed({ users })`), by
   * name or as `{ userName, tenant? }`. Applies to this call only and creates
   * no data. Without `as`, the default `user` from the `c8yTest()` config
   * calls.
   */
  as?: C8yCaller
}

/**
 * Types a user once, so it can be seeded and used as a caller (role names
 * autocomplete).
 *
 * @example
 * ```ts
 * const operator = definePersona({ userName: 'operator', roles: ['ROLE_ALARM_ADMIN'] })
 * c8y.seed({ users: [operator] })
 * it('…', async () => {
 *   await serverFetch('/pumps/SN-1/check', { method: 'POST', as: operator })
 * })
 * ```
 * @param user - The user
 */
export function definePersona<const T extends C8yTestUser>(user: T): T {
  return user
}

/**
 * Calls a route of your service, like `serverFetch()` from `nitro`. With
 * `as`, this call is made by that user: it must exist in the fake tenant
 * (seeded with `c8y.seed({ users })`), the service sees it as the caller, and
 * the platform checks the requests the service sends with its credentials
 * against its roles. Nothing is stored, and the next call is made by the
 * default user again.
 *
 * @example
 * ```ts
 * c8y.seed({ users: [{ userName: 'visitor', roles: [] }] })
 *
 * await serverFetch('/pumps/SN-1')                                         // default user
 * await serverFetch('/pumps/SN-1', { as: 'visitor' })                      // a seeded user
 * await serverFetch('/pumps/SN-1/check', { method: 'POST', as: operator }) // a seeded persona
 * ```
 * @param path - Route path, including the query
 * @param init - Request options, plus `as`
 */
export async function serverFetch(path: string, init: C8yServerFetchInit = {}): Promise<Response> {
  const { as: caller, ...requestInit } = init
  if (isServiceStopped()) {
    throw new Error(TestRunner.getCurrentTest() && !isTestEnded()
      ? 'c8y-nitro/testing: the service is stopped (c8y.stopService(), or a start that failed). Call c8y.startService() first.'
      : 'c8y-nitro/testing: the service is stopped (c8y.stopService(), or a start that failed). The next test starts a new service.')
  }
  if (caller === undefined) {
    return nitroServerFetch(path, requestInit)
  }
  assertActiveTest('serverFetch({ as })')
  const world = useWorld()
  const userName = typeof caller === 'string' ? caller : caller.userName
  const tenant = (typeof caller === 'string' ? undefined : caller.tenant) ?? world.tenant
  if (!world.db.tenant(tenant).users.get(userName)) {
    throw new Error(`serverFetch({ as }): user "${userName}" does not exist in tenant ${tenant} of the fake platform. Seed it first: c8y.seed({ ${tenant === world.tenant ? '' : `tenant: '${tenant}', `}users: [{ userName: '${userName}', roles: [...] }] }).`)
  }
  // dev user injection keeps a sent header, so this user calls the service
  const headers = new Headers(requestInit.headers)
  headers.set('authorization', basicAuth({ tenant, user: userName }))
  return nitroServerFetch(path, { ...requestInit, headers })
}
