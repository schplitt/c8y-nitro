/**
 * The fake Cumulocity platform behind `c8y` in `c8y-nitro/testing`: one
 * fake-c8y world per test file (Vitest isolates modules per file).
 *
 * The world is created on first use, once Nitro's runtime config exists (the
 * own settings category comes from the manifest). Before every test, the data
 * goes back to the plugin baseline, and Notification 2.0 goes back to the
 * subscriptions and tokens the app created at startup: a Nitro plugin that
 * subscribes at startup stays subscribed for every test of the file, while
 * subscriptions a test creates do not reach the next test.
 */
import process from 'node:process'
import { Buffer } from 'node:buffer'
import { useRuntimeConfig } from 'nitro/runtime-config'
import type { C8yUnhandledRequest, TenantSnapshot, World, WorldSnapshot } from 'fake-c8y'
import { createWorld } from 'fake-c8y'
import type { FakeWebSocketClass } from 'fake-c8y/realtime'
import { createFakeWebSocket } from 'fake-c8y/realtime'
import type { C8yTestOptions, C8yTestState, UnhandledRequestStrategy } from './types'
import { DEFAULTS } from './defaults'

interface WorldState {
  world: World
  /**
   * The baseline, taken right after the world was created.
   */
  clean: WorldSnapshot
  /**
   * The Notification 2.0 state after the app started (`markStarted()`), per
   * tenant. Empty until then.
   */
  realtime: RealtimeBaseline[]
  WebSocket: FakeWebSocketClass
}

type RealtimeBaseline = Pick<TenantSnapshot, 'tenant' | 'notificationSubscriptions' | 'notificationTokens'> & { notificationSequence: number | undefined }

let state: WorldState | undefined
let baseline: C8yTestOptions = {}
let onUnhandledRequest: UnhandledRequestStrategy = 'error'
/**
 * Removers of the overrides registered through `c8y.override()`.
 */
let overrides: Array<() => void> = []
/**
 * Managed object refs (`c8y.device()`) bound to their id in the current test.
 */
export const refs = new Map<object, string>()

/**
 * Sets the plugin baseline (before the world exists).
 * @param options - Options of the `c8yTest()` plugin
 */
export function setBaseline(options: C8yTestOptions): void {
  baseline = options
  onUnhandledRequest = options.onUnhandledRequest ?? 'error'
}

/**
 * The world of this test file, created on first use.
 */
export function useWorld(): World {
  return useState().world
}

/**
 * Consumer WebSockets of the world's Notification 2.0.
 */
export function useWebSocket(): FakeWebSocketClass {
  return useState().WebSocket
}

function useState(): WorldState {
  if (!state) {
    const world = createWorld({
      tenant: baseline.tenant,
      user: baseline.user === undefined ? DEFAULTS.user : baseline.user,
      ...(baseline.subscriptions ? { subscriptions: baseline.subscriptions } : {}),
      ...(baseline.tenantOptions ? { tenantOptions: baseline.tenantOptions as Record<string, string> } : {}),
      baseUrl: platformUrl(),
      bootstrapUser: process.env.C8Y_BOOTSTRAP_USER || DEFAULTS.bootstrapUser,
      settingsCategory: useRuntimeConfig().c8ySettingsCategory as string,
      // read Date at call time, so vi.useFakeTimers() controls timestamps
      now: () => Date.now(),
      roles: baseline.roles ?? 'enforce',
      unsupported: (request) => Response.json(
        { error: 'c8y-nitro/testing/unsupported', message: `${request.method} ${request.path}: ${request.reason}. Answer it with c8y.override('${request.method} ${request.path}', ...).` },
        { status: 501 },
      ),
      onUnsupported: (request) => {
        if (onUnhandledRequest === 'warn') {
          console.warn(unhandledMessage([request]))
        }
      },
      onChange: syncEnv,
    })
    state = {
      world,
      clean: world.snapshot(),
      realtime: [],
      WebSocket: createFakeWebSocket(world.realtime, { encodeMessage: (text) => Buffer.from(text) }),
    }
    syncEnv(world)
  }
  return state
}

/**
 * Records the Notification 2.0 subscriptions and tokens the app created at
 * startup as the realtime baseline of every test. Called once the app is
 * ready and its consumers are connected.
 */
export function markStarted(): void {
  const current = useState()
  current.realtime = current.world.snapshot().tenants.filter((tenant) => tenant.notificationSubscriptions?.length || tenant.notificationTokens?.length).map((tenant) => ({
    tenant: tenant.tenant,
    notificationSubscriptions: tenant.notificationSubscriptions,
    notificationTokens: tenant.notificationTokens,
    notificationSequence: tenant.sequences?.notification,
  }))
}

/**
 * Restores the baseline before a test: data, tenant options, users,
 * subscriptions, ids, and the Notification 2.0 state of the app's startup (so
 * the service's startup consumers stay connected). Undelivered notifications
 * are dropped.
 * @returns Unhandled requests recorded since the last check, e.g. by work that
 *   finished after the previous test
 */
export function resetWorld(): C8yUnhandledRequest[] {
  const { world, clean, realtime } = useState()
  const late = world.unhandled
  for (const remove of overrides) {
    remove()
  }
  overrides = []
  refs.clear()
  onUnhandledRequest = baseline.onUnhandledRequest ?? 'error'
  world.restore(withRealtime(clean, realtime))
  world.calls = []
  world.unhandled = []
  return late
}

const FAILURE_HEADER = 'x-c8y-nitro-override-error'
const failures = new Map<string, unknown>()
let nextFailure = 1

/**
 * The answer for an override handler that threw. fake-c8y turns a thrown
 * error into a 500; the patched fetch functions rethrow the error instead, so
 * the service sees a failed request (e.g. a network error), like before.
 * @param error - What the handler threw
 */
export function overrideFailure(error: unknown): Response {
  const id = String(nextFailure++)
  failures.set(id, error)
  return new Response(null, { status: 500, headers: { [FAILURE_HEADER]: id } })
}

/**
 * Rethrows the error of an override handler that threw, else returns the
 * response.
 * @param response - The world's answer
 */
export function rethrowOverrideFailure(response: Response): Response {
  const id = response.headers.get(FAILURE_HEADER)
  if (id !== null && failures.has(id)) {
    const error = failures.get(id)
    failures.delete(id)
    throw error
  }
  return response
}

/**
 * Registers an override that `resetWorld()` removes.
 * @param remove - Remover returned by `world.override()`
 */
export function trackOverride(remove: () => void): void {
  overrides.push(remove)
}

/**
 * Applies a partial state on top of the current one.
 * @param partial - Partial tenant state
 */
export function applyState(partial: Partial<Omit<C8yTestState, 'user'>>): void {
  const { onUnhandledRequest: strategy, tenantOptions, ...rest } = partial
  useWorld().apply({ ...rest, ...(tenantOptions ? { tenantOptions: tenantOptions as Record<string, string> } : {}) })
  if (strategy !== undefined) {
    onUnhandledRequest = strategy
  }
}

export function useUnhandledStrategy(): UnhandledRequestStrategy {
  return onUnhandledRequest
}

export function platformUrl(): string {
  return process.env.C8Y_BASEURL || DEFAULTS.baseUrl
}

/**
 * The failure message for requests the fake tenant could not answer.
 * @param calls - The unhandled requests
 * @param when - When they happened, if not during the test
 */
export function unhandledMessage(calls: readonly C8yUnhandledRequest[], when?: string): string {
  const failed = calls.filter((call) => call.kind === 'error')
  const unsupported = calls.filter((call) => call.kind !== 'error')
  return [
    ...(unsupported.length > 0
      ? [
          `c8y-nitro/testing: ${unsupported.length} Cumulocity request(s)${when ? ` ${when}` : ''} the fake tenant does not support:`,
          ...unsupported.map((call) => `  ${call.method} ${call.path} (${call.reason})`),
          'Answer them with c8y.override(\'METHOD /path\', handler) (see "What the fake emulates" in the testing guide), or set onUnhandledRequest to \'warn\' or \'ignore\'.',
        ]
      : []),
    ...(failed.length > 0
      ? [
          `c8y-nitro/testing: ${failed.length} Cumulocity request(s)${when ? ` ${when}` : ''} failed inside the fake tenant (answered 500):`,
          ...failed.map((call) => `  ${call.method} ${call.path} (${call.reason})`),
        ]
      : []),
  ].join('\n')
}

/**
 * The clean snapshot with the Notification 2.0 subscriptions, tokens, and
 * their id sequence from the app's startup.
 * @param clean - The baseline
 * @param realtime - The realtime baseline
 */
function withRealtime(clean: WorldSnapshot, realtime: readonly RealtimeBaseline[]): WorldSnapshot {
  const tenants = new Map(clean.tenants.map((tenant) => [tenant.tenant, tenant]))
  for (const { tenant, notificationSubscriptions, notificationTokens, notificationSequence } of realtime) {
    const base = tenants.get(tenant) ?? emptyTenant(tenant)
    tenants.set(tenant, {
      ...base,
      notificationSubscriptions,
      notificationTokens,
      ...(base.sequences && notificationSequence !== undefined ? { sequences: { ...base.sequences, notification: notificationSequence } } : {}),
    })
  }
  return { ...clean, tenants: [...tenants.values()] }
}

/**
 * A tenant the baseline does not have, as the platform starts it.
 * @param tenant - Tenant id
 */
function emptyTenant(tenant: string): TenantSnapshot {
  const world = createWorld({ tenant, user: null, subscriptions: [] })
  // reading from a tenant creates it with its defaults
  world.options.get('-', { tenant })
  const created = world.snapshot().tenants.find((item) => item.tenant === tenant)
  if (!created) {
    throw new Error(`c8y-nitro/testing: could not create an empty snapshot of tenant ${tenant}`)
  }
  return created
}

/**
 * Keeps the dev and bootstrap env in sync with the tenant and current user.
 * @param world - The world that changed
 */
function syncEnv(world: World): void {
  process.env.C8Y_BOOTSTRAP_TENANT = world.tenant
  process.env.C8Y_DEVELOPMENT_TENANT = world.user?.tenant ?? world.tenant
  process.env.C8Y_DEVELOPMENT_USER = world.user?.userName ?? DEFAULTS.user.userName
}
