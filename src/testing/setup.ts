// Vitest setup file registered by the `c8yTest()` plugin. Runs in every test
// file of the project, inside Nitro's `nitro` test environment.
import { FetchClient } from '@c8y/client'
import { compileRoute, matchRoute, splitPath } from 'fake-c8y'
import { afterAll, afterEach, beforeAll, beforeEach, expect, inject, TestRunner } from 'vitest'
import { PROVIDE_KEY } from './defaults'
import { markRunning, trackSuite, trackTest } from './scope'
import type { C8yUnhandledRequest } from 'fake-c8y'
import type { UnhandledRequestStrategy } from './types'
import { platformUrl, prepareTest, setBaseline, unhandledMessage, useUnhandledStrategy, useWebSocket, useWorld } from './world'
import { setTestingHooks } from '../utils/internal/testing'

interface FetchClientInternals {
  getUrl: (url: string, init?: object) => string
  getFetchOptions: (init?: object) => ConstructorParameters<typeof Request>[1]
  adjustOptionsForFormData: (options: ConstructorParameters<typeof Request>[1]) => ConstructorParameters<typeof Request>[1]
}

// Every request of the real @c8y/client (services, static helpers) goes through
// FetchClient.prototype.fetch. Answer it from the fake tenant instead of the
// network, keeping the client's own URL, query, and auth header handling.
FetchClient.prototype.fetch = async function (this: FetchClientInternals, url: string, init?: object) {
  const options = this.adjustOptionsForFormData(this.getFetchOptions(init)) as Record<string, any>
  const fullUrl = new URL(this.getUrl(url, init), platformUrl())
  // @c8y/client uploads with the Node `form-data` package (a stream, not a
  // WHATWG FormData): send its serialized bytes with its multipart boundary.
  const body = options.body
  if (body && typeof body.getBuffer === 'function' && typeof body.getBoundary === 'function') {
    const headers = new Headers(options.headers)
    headers.set('content-type', `multipart/form-data; boundary=${body.getBoundary()}`)
    return useWorld().fetch(new Request(fullUrl, { ...options, headers, body: body.getBuffer() }))
  }
  return useWorld().fetch(new Request(fullUrl, options))
} as unknown as FetchClient['fetch']

// Requests with the global fetch (e.g. c8y-realtime's REST calls, or a service
// that calls the platform without @c8y/client) to the platform's URL are
// answered by the fake tenant too.
const originalFetch = globalThis.fetch
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const request = new Request(input, init)
  const platformOrigin = new URL(platformUrl()).origin
  return new URL(request.url).origin === platformOrigin ? useWorld().fetch(request) : originalFetch(input, init)
}) as typeof fetch

// Notification 2.0 consumers of c8y-nitro's realtime client connect to the fake.
setTestingHooks({
  get WebSocket() {
    return useWebSocket()
  },
  taskRegistries: new Set(),
  instanceState: new Set(),
})

// Track the suite that runs, so `c8y.startService()` in a `beforeAll` knows
// which `describe` (or file) it shares a service with.
const runnerHooks = TestRunner.prototype as unknown as {
  onBeforeRunSuite?: (suite: object) => unknown
  onAfterRunSuite?: (suite: object) => unknown
}
const onBeforeRunSuite = runnerHooks.onBeforeRunSuite
const onAfterRunSuite = runnerHooks.onAfterRunSuite
runnerHooks.onBeforeRunSuite = async function (this: unknown, suite: object) {
  // Vitest reports only suites that run as finished: track only those
  const { mode, result } = suite as { mode?: string, result?: { state?: string } }
  if (mode !== 'skip' && mode !== 'todo' && result?.state !== 'fail') {
    trackSuite(suite, true)
  }
  return onBeforeRunSuite?.call(this, suite)
}
runnerHooks.onAfterRunSuite = async function (this: unknown, suite: object) {
  try {
    return await onAfterRunSuite?.call(this, suite)
  } finally {
    trackSuite(suite, false)
  }
}

// The world is created on first use (it needs Nitro's runtime config).
setBaseline(inject(PROVIDE_KEY) ?? {})

beforeAll(() => {
  markRunning()
  // The deployed tenant, subscriptions, and user exist before the service starts.
  useWorld()
})

// Registered before any test file hook, so it runs first: the scope-aware
// arrange calls of the file and its describes replay after it.
beforeEach(async ({ task }) => {
  trackTest(task, true)
  const world = useWorld()
  // requests that failed after the previous test ended (background work),
  // judged by the strategy that test had
  const late = world.unhandled
  world.unhandled = []
  failUnhandled(late, useUnhandledStrategy(), 'after the previous test ended')
  // back to the startup state, on the service instance of the test's scope
  // (started now if the scope needs a new one)
  const startup = await prepareTest(task)
  failUnhandled(startup, useUnhandledStrategy(), 'while the service started')
})

afterEach(({ task }) => {
  trackTest(task, false)
  const world = useWorld()
  const unhandled = world.unhandled
  world.unhandled = []
  failUnhandled(unhandled, useUnhandledStrategy())
})

afterAll(() => {
  // requests that failed after the last test of the file ended (Nitro's own
  // teardown closes the service afterwards)
  const world = useWorld()
  const unhandled = world.unhandled
  world.unhandled = []
  failUnhandled(unhandled, useUnhandledStrategy(), 'after the last test ended')
})

/**
 * Fails the current hook for unhandled requests (with `onUnhandledRequest:
 * 'error'`, the default).
 * @param unhandled - The unhandled requests
 * @param strategy - The strategy to judge them by
 * @param when - When they happened, if not during the test
 */
function failUnhandled(unhandled: readonly C8yUnhandledRequest[], strategy: UnhandledRequestStrategy, when?: string): void {
  if (unhandled.length > 0 && strategy === 'error') {
    throw new Error(unhandledMessage(unhandled, when))
  }
}

expect.extend({
  toHaveReceived(_received: unknown, pattern: string, options: { times?: number } = {}) {
    const route = compileRoute(pattern)
    const calls = useWorld().calls
    const matching = calls.filter((call) => matchRoute(route, call.method, splitPath(call.path)))
    const pass = options.times === undefined ? matching.length > 0 : matching.length === options.times
    const expected = options.times === undefined ? 'at least one request' : `${options.times} request(s)`
    const received = calls.length > 0
      ? calls.map((call) => `  ${call.method} ${call.path}`).join('\n')
      : '  (none)'
    return {
      pass,
      message: () => pass
        ? `expected no request matching ${pattern}, but got ${matching.length}`
        : `expected ${expected} matching ${pattern}, got ${matching.length}.\nRequests to the platform in this test:\n${received}`,
    }
  },
})
