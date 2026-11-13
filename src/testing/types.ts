import type { C8YRole, C8YRoles, C8YTenantOptionKey } from 'c8y-nitro/types'

/**
 * A role: the manifest's custom roles, known platform roles, or any string.
 */
export type C8yTestRole = keyof C8YRoles | C8YRole

/**
 * The user calling the microservice (returned by `GET /user/currentUser`).
 */
export interface C8yTestUser {
  userName: string
  /**
   * Effective roles of the user.
   */
  roles?: C8yTestRole[]
  /**
   * Tenant the user belongs to. Defaults to the tenant the microservice is
   * deployed in. Drives the injected dev user's auth header.
   */
  tenant?: string
  /**
   * Any other `ICurrentUser` fields (email, firstName, …).
   */
  [field: string]: unknown
}

/**
 * Service user credentials of a tenant subscribed to the microservice.
 */
export interface C8yTestSubscription {
  tenant: string
  user: string
  password: string
}

/**
 * What to do with platform requests no handler answers.
 */
export type UnhandledRequestStrategy = 'error' | 'warn' | 'ignore'

/**
 * State of the fake Cumulocity tenant. Used as the baseline in the
 * `c8yTest()` plugin config, and as partial overrides in
 * `c8y.apply()`.
 */
export interface C8yTestState {
  /**
   * Tenant the microservice is deployed in (the bootstrap tenant).
   * @default 't12345'
   */
  tenant?: string
  /**
   * User calling the microservice. `null` makes `GET /user/currentUser`
   * answer 401.
   * @default { userName: 'test-user', roles: [] }
   */
  user?: C8yTestUser | null
  /**
   * Tenants subscribed to the microservice, with their service users.
   * @default one subscription for the deployed tenant
   */
  subscriptions?: C8yTestSubscription[]
  /**
   * Tenant options of the microservice's own settings category, in the deployed tenant.
   */
  tenantOptions?: Partial<Record<C8YTenantOptionKey, string>> & Record<string, string>
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
   * The raw request, body already consumed.
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
   * on the platform. Only users you seed with `c8y.seed({ users })` (other
   * than the current user) are restricted; the service's own credentials and
   * the current user keep full access. `'off'` gives every caller full access.
   * @default 'enforce'
   */
  roles?: 'enforce' | 'off'
}

declare module 'vitest' {
  interface ProvidedContext {
    /**
     * Baseline options of the `c8yTest()` plugin.
     */
    c8yNitroTest: C8yTestOptions
  }
}
