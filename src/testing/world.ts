/**
 * The fake Cumulocity platform behind `c8y` in `c8y-nitro/testing`: one
 * fake-c8y world per test file (Vitest isolates modules per file).
 *
 * The world is created on first use, once Nitro's runtime config exists (the
 * own settings category comes from the manifest). Before every test, the data
 * goes back to the plugin baseline, while Notification 2.0 subscriptions and
 * tokens stay: a Nitro plugin that subscribes at startup stays subscribed for
 * every test of the file.
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
  WebSocket: FakeWebSocketClass
}

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
      WebSocket: createFakeWebSocket(world.realtime, { encodeMessage: (text) => Buffer.from(text) }),
    }
    syncEnv(world)
  }
  return state
}

/**
 * Restores the baseline before a test: data, tenant options, users,
 * subscriptions, and ids. Notification 2.0 subscriptions and tokens stay, so
 * the service's consumers stay connected; undelivered notifications are
 * dropped.
 */
export function resetWorld(): void {
  const { world, clean } = useState()
  for (const remove of overrides) {
    remove()
  }
  overrides = []
  refs.clear()
  onUnhandledRequest = baseline.onUnhandledRequest ?? 'error'
  world.restore(keepRealtime(clean, world.snapshot()))
  world.calls = []
  world.unhandled = []
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

export function unhandledMessage(calls: readonly C8yUnhandledRequest[]): string {
  return [
    `c8y-nitro/testing: ${calls.length} Cumulocity request(s) the fake tenant does not support:`,
    ...calls.map((call) => `  ${call.method} ${call.path} (${call.reason})`),
    'Answer them with c8y.override(\'METHOD /path\', handler) (see "What the fake emulates" in the testing guide), or set onUnhandledRequest to \'warn\' or \'ignore\'.',
  ].join('\n')
}

/**
 * The clean snapshot with the Notification 2.0 subscriptions and tokens (and
 * their id sequence) of the current one.
 * @param clean - The baseline
 * @param current - The world now
 */
function keepRealtime(clean: WorldSnapshot, current: WorldSnapshot): WorldSnapshot {
  const tenants = new Map(clean.tenants.map((tenant) => [tenant.tenant, tenant]))
  for (const tenant of current.tenants) {
    if (!tenant.notificationSubscriptions?.length && !tenant.notificationTokens?.length) {
      continue
    }
    const base = tenants.get(tenant.tenant) ?? emptyTenant(tenant.tenant)
    tenants.set(tenant.tenant, {
      ...base,
      notificationSubscriptions: tenant.notificationSubscriptions,
      notificationTokens: tenant.notificationTokens,
      ...(base.sequences && tenant.sequences ? { sequences: { ...base.sequences, notification: tenant.sequences.notification } } : {}),
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
  return world.snapshot().tenants.find((item) => item.tenant === tenant) ?? { ...world.snapshot().tenants[0]!, tenant }
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
