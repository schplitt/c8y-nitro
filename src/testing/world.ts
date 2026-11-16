/**
 * The fake Cumulocity platform behind `c8y` in `c8y-nitro/testing` (one
 * fake-c8y world per test file, as Vitest isolates modules per file), and the
 * lifecycle of the service instance (the Nitro app) that runs against it.
 *
 * The world is created on first use, once Nitro's runtime config exists (the
 * own settings category comes from the manifest). It takes two checkpoints:
 * `clean` right after creation, and `startup` after the service started.
 * Before every test the world goes back to `startup` and keeps the service's
 * open Notification 2.0 consumers. When the test needs a new service instance
 * (`c8y.startService()`), the old instance is closed, the world goes back to
 * `clean`, and a new instance starts.
 */
import process from 'node:process'
import { useRuntimeConfig } from 'nitro/runtime-config'
import { c8yManifest } from 'c8y-nitro/runtime'
import type { C8yCheckpoint, C8yLogMark, C8yLogRange, C8yMicroserviceManifest, C8yRequest, C8yUnhandledRequest, World } from 'fake-c8y'
import { createWorld } from 'fake-c8y'
import type { FakeWebSocketClass } from 'fake-c8y/realtime'
import { createFakeWebSocket, SettleTimeoutError } from 'fake-c8y/realtime'
import type { C8yTestOptions, C8yTestState, UnhandledRequestStrategy } from './types'
import { DEFAULTS } from 'fake-c8y/defaults'
import { arrangementsOf, concurrentError, isConcurrentRunning } from './scope'
import { useTestingHooks } from '../utils/internal/testing'

interface WorldState {
  world: World
  /**
   * Taken right after the world was created: the baseline of a new service
   * instance.
   */
  clean: C8yCheckpoint
  /**
   * Taken after the current service instance started: the baseline of every
   * test that runs on it.
   */
  startup: C8yCheckpoint | undefined
  WebSocket: FakeWebSocketClass
}

/**
 * Milliseconds the startup work through the fake may take.
 */
const STARTUP_TIMEOUT = 5000

let state: WorldState | undefined
let baseline: C8yTestOptions = {}
let onUnhandledRequest: UnhandledRequestStrategy = 'error'
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
      ...(baseline.tenantOptions ? { tenantOptions: baseline.tenantOptions } : {}),
      baseUrl: platformUrl(),
      bootstrapUser: process.env.C8Y_BOOTSTRAP_USER || DEFAULTS.bootstrapUser,
      settingsCategory: useRuntimeConfig().c8ySettingsCategory as string,
      // manifest roles exist in the tenants, settings defaults are tenant
      // options, and service users have the manifest's requiredRoles
      // cast: fake-c8y's manifest type has an index signature that a typed interface cannot satisfy; remove it once fake-c8y accepts it
      manifest: c8yManifest as unknown as C8yMicroserviceManifest,
      // read Date at call time, so vi.useFakeTimers() controls timestamps
      now: () => Date.now(),
      roles: baseline.roles ?? 'enforce',
      overrideHint: (request) => `c8y.override('${request.method} ${request.path}', ...)`,
      onUnsupported: (request) => {
        if (onUnhandledRequest === 'warn') {
          console.warn(unhandledMessage([request]))
        }
      },
      onChange: syncEnv,
    })
    state = {
      world,
      clean: world.checkpoint(),
      startup: undefined,
      WebSocket: createFakeWebSocket(world.realtime, { flavor: 'ws' }),
    }
    syncEnv(world)
  }
  return state
}

// ---------------------------------------------------------------------------
// Service instances

/**
 * The scopes (Vitest suite or file tasks) whose tests share one service
 * instance: `c8y.startService()` was called in their `beforeAll`.
 */
const sharedScopes = new WeakSet<object>()
/**
 * What the current service instance belongs to (see `instanceKey()`), or
 * `undefined` when no instance runs or the next test must get a new one.
 */
let currentInstance: object | undefined
/**
 * The key of the instance the concurrent tests of a suite share.
 */
const concurrentKeys = new WeakMap<object, object>()
/**
 * Whether a service instance runs (Nitro app created and started).
 */
let running = false
/**
 * Whether the next start must create a new Nitro app (the current one was
 * closed).
 */
let replaceApp = false
/**
 * The preparation of the test before (tests are prepared one at a time).
 */
let preparing: Promise<unknown> = Promise.resolve()
/**
 * The refs bound by the arrangements the current instance started with.
 */
let startupRefs = new Map<object, string>()
/**
 * The unhandled request strategy after the arrangements the current instance
 * started with.
 */
let startupStrategy: UnhandledRequestStrategy = 'error'

/**
 * Realtime clients that existed when the current instance finished starting.
 */
let startupRealtimeTenants = new Set<string>()

/**
 * Where the current test's part of the call log starts: taken after the
 * platform was reset (and the service started) for the test.
 */
let testMark: C8yLogMark | undefined
/**
 * The service restarts inside the current test (`c8y.startService()`): their
 * requests are not the test's.
 */
let restarts: C8yLogRange[] = []

/**
 * Gives the tests of a scope one shared service instance, started (before
 * its first test) on the arrangements down to that scope.
 * @param scope - The suite (or file) task
 */
export function shareService(scope: object): void {
  sharedScopes.add(scope)
}

interface TaskLike {
  suite?: TaskLike
  file?: TaskLike
}

interface InstanceKey {
  /**
   * Tests whose key is the same object run on the same instance (while they
   * run one after the other). A test without a shared instance gets a new
   * object for every run, also for a retry or a repeat of the same test.
   */
  key: object
  /**
   * The scope whose arrangements (and the ones of its parents) the instance
   * starts with; `undefined`: all scopes of the test.
   */
  scope: TaskLike | undefined
}

/**
 * Which instance a test runs on: the one of its innermost scope that shares
 * one (`c8y.startService()` in its `beforeAll`), else, with
 * `c8yTest({ service: 'per-file' })`, the file's, else a fresh one.
 * @param task - The test
 */
function instanceKey(task: TaskLike): InstanceKey {
  const file = task.file ?? task
  for (let scope: TaskLike | undefined = task.suite ?? file; scope; scope = scope === file ? undefined : (scope.suite ?? file)) {
    if (sharedScopes.has(scope)) {
      return { key: scope, scope }
    }
  }
  return baseline.service === 'per-file' ? { key: file, scope: file } : { key: {}, scope: undefined }
}

/**
 * Prepares the platform and the service instance for a test: the platform
 * goes back to its baseline, and the test runs on the instance it shares with
 * the tests of its scope, started now if needed.
 * @param task - The test about to run
 * @returns Unhandled requests of the service startup, if it started now
 */
export function prepareTest(task: TaskLike): Promise<C8yUnhandledRequest[]> {
  // one at a time: concurrent tests must not interleave a restart
  const prepared = preparing.then(() => prepare(task))
  preparing = prepared.catch(() => {})
  return prepared
}

async function prepare(task: TaskLike & { name?: string, concurrent?: boolean }): Promise<C8yUnhandledRequest[]> {
  const current = useState()
  const { world } = current
  onUnhandledRequest = baseline.onUnhandledRequest ?? 'error'
  // the scopes of the test, outermost (the file) first
  const file = task.file ?? task
  const scopes: TaskLike[] = []
  for (let suite = task.suite; suite; suite = suite.suite) {
    scopes.unshift(suite)
  }
  scopes.unshift(file)
  const concurrent = scopes.flatMap((scope) => arrangementsOf(scope)).find(() => task.concurrent)
  if (concurrent) {
    throw concurrentError(concurrent.name, task.name ?? '')
  }
  if (task.concurrent) {
    // The concurrent tests of a suite (they arrange nothing) share one service
    // on a clean tenant, and never reset it under each other.
    const group = task.suite ?? file
    let key = concurrentKeys.get(group)
    if (!key) {
      key = {}
      concurrentKeys.set(group, key)
    }
    if (current.startup && currentInstance === key) {
      return []
    }
    releaseTestLog()
    await stopService()
    world.reset({ to: current.clean })
    refs.clear()
    const unhandled = await startService()
    currentInstance = key
    markTest()
    return unhandled
  }
  if (isConcurrentRunning()) {
    // Vitest runs concurrent suites side by side: preparing this test would
    // reset the platform and the service under them
    throw new Error(`c8y-nitro/testing: "${task.name ?? ''}" runs while concurrent tests of a sibling suite run. A suite with { concurrent: true } may only contain concurrent tests that arrange nothing; move this test out of it, or pass { concurrent: false } to the suites around it.`)
  }
  // the scopes down to the one that owns the instance are arranged before the
  // service starts; the deeper ones before each test
  const { key, scope } = instanceKey(task)
  const shared = scope === undefined ? scopes.length : scopes.indexOf(scope) + 1
  releaseTestLog()
  if (current.startup && currentInstance === key) {
    await closeRealtimeClientsSinceStartup()
    world.reset({ to: current.startup, consumers: 'keep' })
    refs.clear()
    for (const [ref, id] of startupRefs) {
      refs.set(ref, id)
    }
    onUnhandledRequest = startupStrategy
    replay(scopes.slice(shared))
    markTest()
    return []
  }
  await stopService()
  world.reset({ to: current.clean })
  refs.clear()
  replay(scopes.slice(0, shared))
  const unhandled = await startService()
  currentInstance = key
  startupRefs = new Map(refs)
  // a strategy set by the shared arrangements (`c8y.apply()`) is not world state
  startupStrategy = onUnhandledRequest
  replay(scopes.slice(shared))
  markTest()
  return unhandled
}

/**
 * Replays the arrange calls of scopes, outermost first, without notifying the
 * service (rebuilt data is not a change).
 * @param scopes - The scopes
 */
function replay(scopes: readonly TaskLike[]): void {
  const world = useWorld()
  for (const scope of scopes) {
    for (const { operation } of arrangementsOf(scope)) {
      world.muted(operation)
    }
  }
}

/**
 * Starts a new service instance on the current platform state and takes the
 * `startup` checkpoint.
 * @returns Unhandled requests the startup sent
 */
async function startService(): Promise<C8yUnhandledRequest[]> {
  const current = useState()
  const { world } = current
  // Nitro creates the app lazily on the first request: create it now and
  // wait for async plugins, so startup work such as realtime subscriptions is
  // in place even for tests that never call a route. The closed app is
  // replaced only now, so background work of the previous test cannot create
  // the new one on stale data. The startup requests are not part of any
  // test's call log; marked before the app exists, so requests that plugins
  // send while it is created count too.
  const from = world.mark()
  try {
    const { useNitroApp } = await import('nitro/app')
    if (replaceApp) {
      // late background work of the old instance may have touched module state
      resetRuntimeState()
      ;(useNitroApp as { _instance?: unknown })._instance = undefined
      replaceApp = false
    }
    const app = useNitroApp() as { ready?: Promise<void> }
    running = true
    await app.ready
    // the startup work that runs through the fake (requests, connecting
    // sockets) is done; a start still busy after 5 s fails
    await settleStartup(world)
  } catch (error) {
    // a failed start is closed, so the next test starts a new instance; the
    // start error fails this test, its unhandled requests are dropped
    world.takeUnhandledSince(from)
    from.release()
    await stopService()
    throw error
  }
  const unhandled = world.takeUnhandledSince(from)
  from.release()
  current.startup = world.checkpoint()
  startupRealtimeTenants = new Set(useTestingHooks()?.realtimePool?.keys() ?? [])
  return unhandled
}

/**
 * Waits for the startup work that runs through the fake, with a c8y-nitro
 * message when it does not finish within `STARTUP_TIMEOUT`.
 * @param world - The world
 */
async function settleStartup(world: World): Promise<void> {
  try {
    await world.realtime.settled({ timeout: STARTUP_TIMEOUT })
  } catch (error) {
    if (error instanceof SettleTimeoutError) {
      const open = Object.entries(error.status).filter(([, count]) => count > 0).map(([field, count]) => `${field} ${count}`)
      throw new Error(`c8y-nitro/testing: the service start did not finish within ${STARTUP_TIMEOUT} ms, its work through the fake tenant still runs (${open.join(', ') || 'nothing open at the last check'})`, { cause: error })
    }
    throw error
  }
}

/**
 * Closes the current service instance, if one runs: Nitro's `close` hook runs
 * (plugins clean up, realtime clients close), `c8yTasks()` jobs stop,
 * c8y-nitro's caches are cleared, and the next start creates a new app.
 */
export async function stopService(): Promise<void> {
  const current = useState()
  if (!running) {
    return
  }
  running = false
  current.startup = undefined
  currentInstance = undefined
  replaceApp = true
  const { useNitroApp } = await import('nitro/app')
  const app = useNitroApp() as { hooks?: { callHook: (name: string) => Promise<unknown> } }
  try {
    await app.hooks?.callHook('close')
  } finally {
    resetRuntimeState()
    // Imported lazily: loading c8y-nitro/utils before Nitro created the app
    // would enter Nitro's runtime through an import cycle.
    const { useSubscribedTenantCredentials, useTenantOptions } = await import('c8y-nitro/utils')
    await useSubscribedTenantCredentials.invalidate()
    await useTenantOptions.invalidateAll()
  }
}

/**
 * Resets c8y-nitro's module state that belongs to one service instance:
 * scheduled jobs, realtime pool wiring, the previous credentials of
 * `c8y:tenantCredentialsUpdated` (registered by those modules in the test
 * seam).
 */
function resetRuntimeState(): void {
  const hooks = useTestingHooks()
  for (const stopJobs of hooks?.taskRegistries ?? []) {
    stopJobs()
  }
  for (const reset of hooks?.instanceState ?? []) {
    reset()
  }
}

/**
 * Restarts the service inside a test, on the test's current platform state.
 * The next test gets a new instance too.
 */
export async function restartService(): Promise<void> {
  const current = useState()
  const { world } = current
  // the test's own requests stay in its log; the restart's do not
  const from = world.mark()
  let unhandled: C8yUnhandledRequest[] = []
  try {
    await stopService()
    unhandled = await startService()
  } finally {
    const until = world.mark()
    restarts.push({ from, until })
    // the ones of the stop (the start took its own); dropped if the start failed
    unhandled = [...world.takeUnhandledSince(from, until), ...unhandled]
  }
  // the startup checkpoint holds this test's data: no other test may use it
  current.startup = undefined
  if (unhandled.length > 0 && onUnhandledRequest === 'error') {
    throw new Error(unhandledMessage(unhandled, 'while the service restarted'))
  }
}

/**
 * Closes the realtime clients the service created after it started (lazily
 * in a route, or for a tenant added in a test), so the next use creates a new
 * one: their subscriptions do not survive the reset to the startup state.
 */
async function closeRealtimeClientsSinceStartup(): Promise<void> {
  const pool = useTestingHooks()?.realtimePool
  if (!pool) {
    return
  }
  for (const [tenant, client] of [...pool]) {
    if (!startupRealtimeTenants.has(tenant)) {
      pool.delete(tenant)
      await client.close().catch(() => {})
    }
  }
}

// ---------------------------------------------------------------------------
// The test's call log

/**
 * Starts the current test's part of the call log (after a reset: marks of the
 * log before it are no longer valid).
 */
function markTest(): void {
  releaseTestLog()
  testMark = useWorld().mark()
}

/**
 * Releases the marks of the current test's call log (before a reset, and when
 * the file ends).
 */
export function releaseTestLog(): void {
  testMark?.release()
  for (const { from, until } of restarts) {
    from.release()
    until?.release()
  }
  testMark = undefined
  restarts = []
}

/**
 * The requests of the current test, without the ones of service restarts.
 */
export function testCalls(): C8yRequest[] {
  return testMark ? useWorld().callsSince(testMark, undefined, { except: restarts }) : []
}

/**
 * The requests of the current test the fake tenant could not answer, and not
 * reported yet.
 */
export function testUnhandled(): C8yUnhandledRequest[] {
  return testMark ? useWorld().unhandledSince(testMark) : []
}

/**
 * Like `testUnhandled()`, and marks them reported: a later call returns only
 * the ones recorded since (e.g. background work after the test ended).
 */
export function takeTestUnhandled(): C8yUnhandledRequest[] {
  return testMark ? useWorld().takeUnhandledSince(testMark) : []
}

// ---------------------------------------------------------------------------
// State helpers

/**
 * Applies a partial state on top of the current one.
 * @param partial - Partial tenant state
 */
export function applyState(partial: Partial<Omit<C8yTestState, 'user'>>): void {
  const { onUnhandledRequest: strategy, tenantOptions, ...rest } = partial
  useWorld().apply({ ...rest, ...(tenantOptions ? { tenantOptions } : {}) })
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
  const at = when ? ` ${when}` : ''
  return [
    ...(unsupported.length > 0
      ? [
          `c8y-nitro/testing: ${unsupported.length} Cumulocity request(s)${at} the fake tenant does not support:`,
          ...unsupported.map((call) => `  ${call.method} ${call.path} (${call.reason})`),
          'Answer them with c8y.override(\'METHOD /path\', handler) (see "What the fake emulates" in the testing guide), or set onUnhandledRequest to \'warn\' or \'ignore\'.',
        ]
      : []),
    ...(failed.length > 0
      ? [
          `c8y-nitro/testing: ${failed.length} Cumulocity request(s)${at} failed inside the fake tenant (answered 500):`,
          ...failed.map((call) => `  ${call.method} ${call.path} (${call.reason})`),
          'If a c8y.override() handler threw: to answer with an error on purpose, return a Response with that status instead.',
        ]
      : []),
  ].join('\n')
}

/**
 * Keeps the dev and bootstrap env in sync with the tenant and current user.
 * @param world - The world that changed
 */
export function syncEnv(world: World): void {
  process.env.C8Y_BOOTSTRAP_TENANT = world.tenant
  process.env.C8Y_DEVELOPMENT_TENANT = world.user?.tenant ?? world.tenant
  process.env.C8Y_DEVELOPMENT_USER = world.user?.userName ?? DEFAULTS.user.userName
}
