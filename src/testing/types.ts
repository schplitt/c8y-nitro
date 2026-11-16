import type { C8YRole, C8YRoles, C8YTenantOptionKey } from 'c8y-nitro/types'
import type { C8ySubscription, C8yUser, C8yWorldState } from 'fake-c8y'

/**
 * A role: the manifest's custom roles, known platform roles, or any string.
 */
export type C8yTestRole = keyof C8YRoles | C8YRole

/**
 * The user calling the microservice (returned by `GET /user/currentUser`):
 * `userName`, `roles`, `tenant` (default: the tenant the microservice is
 * deployed in; drives the injected dev user's auth header), and any other
 * `ICurrentUser` fields (email, firstName, …).
 */
export type C8yTestUser = C8yUser<C8yTestRole>

/**
 * Service user credentials of a tenant subscribed to the microservice.
 */
export type C8yTestSubscription = C8ySubscription

/**
 * What to do with platform requests no handler answers.
 */
export type UnhandledRequestStrategy = 'error' | 'warn' | 'ignore'

/**
 * State of the fake Cumulocity tenant. Used as the baseline in the
 * `c8yTest()` plugin config, and as partial overrides in
 * `c8y.apply()`.
 */
export interface C8yTestState extends C8yWorldState<C8yTestRole, C8YTenantOptionKey> {
  /**
   * What to do with platform requests that no handler answers. `'error'`
   * fails the test after it ran.
   * @default 'error'
   */
  onUnhandledRequest?: UnhandledRequestStrategy
}

/**
 * Context passed to a `c8y.override()` handler: the request, the params the
 * pattern captured, and `next()` to pass the request on.
 */
export interface C8yRequestContext {
  method: string
  /**
   * Path without query, e.g. `/inventory/managedObjects/42`.
   */
  path: string
  query: Record<string, string>
  /**
   * Parsed JSON body, raw text, or `undefined`.
   */
  body: unknown
  headers: Record<string, string>
  /**
   * Tenant the request works in: the caller's tenant (Basic auth prefix),
   * else the deployed tenant.
   */
  tenant: string
  /**
   * User name from basic auth, if any.
   */
  user: string | undefined
  /**
   * Route params captured by the pattern: `:name` segments, and `_` for the
   * rest a `**` matched.
   */
  params: Record<string, string>
  /**
   * A copy of the `Request` the service sent, with a readable body (e.g.
   * the bytes of a binary upload).
   */
  request: Request
  /**
   * How many requests this override got in this test, this one included:
   * `callCount === 2` is its second request.
   */
  callCount: number
  /**
   * Answers the request as if this override did not exist (an older
   * override, else the fake platform) and returns that answer. Use it to add
   * latency, or to let the platform store a write while the service sees an
   * error. Callable once per request.
   */
  next: () => Promise<Response>
}

/**
 * Answers a platform request. Return a `Response` for full control (status,
 * headers), any other value to answer `200` with it as JSON, or nothing for
 * `204`.
 */
export type C8yRequestHandler = (context: C8yRequestContext) => unknown

/**
 * Options for the `c8yTest()` Vite plugin.
 */
export interface C8yTestOptions extends C8yTestState {
  /**
   * Base URL the fake platform pretends to live at (`C8Y_BASEURL`).
   * @default 'https://t12345.cumulocity.test'
   */
  baseUrl?: string
  /**
   * Whether platform requests are checked against the caller's rights, like
   * on the platform: users you seed with `c8y.seed({ users })`, also as
   * callers of `serverFetch(path, { as })`, get 403 where they lack the
   * rights, and your service's service users have only the manifest's
   * `requiredRoles`. The default `user` and requests without credentials keep
   * full access. `'off'` gives every caller full access.
   * @default 'enforce'
   */
  roles?: 'enforce' | 'off'
  /**
   * How long one instance of the service (a Nitro app, with its plugins,
   * caches, and realtime clients) lives: `'per-test'` starts a new one for
   * every test, `'per-file'` shares one between the tests of a file (caches
   * carry over, like on a running service). `c8y.startService()` in a
   * `beforeAll`, `beforeEach`, or test changes it locally.
   * @default 'per-test'
   */
  service?: 'per-test' | 'per-file'
}

declare module 'vitest' {
  interface ProvidedContext {
    /**
     * Baseline options of the `c8yTest()` plugin.
     */
    c8yNitroTest: C8yTestOptions
  }
}
