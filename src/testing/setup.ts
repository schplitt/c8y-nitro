// Vitest setup file registered by the `c8yTest()` plugin. Runs in every test
// file of the project, inside Nitro's `nitro` test environment.
import process from 'node:process'
import { FetchClient } from '@c8y/client'
import { afterEach, beforeAll, beforeEach, expect, inject } from 'vitest'
import { DEFAULTS, PROVIDE_KEY } from './defaults'
import { platform, unhandledMessage } from './platform'
import { compileRoute, matchRoute, splitPath } from './router'
import { markRunning } from './scope'

interface FetchClientInternals {
  getUrl: (url: string, init?: object) => string
  getFetchOptions: (init?: object) => ConstructorParameters<typeof Request>[1]
  adjustOptionsForFormData: (options: ConstructorParameters<typeof Request>[1]) => ConstructorParameters<typeof Request>[1]
}

// Every request of the real @c8y/client (services, static helpers) goes through
// FetchClient.prototype.fetch. Answer it from the fake tenant instead of the
// network, keeping the client's own URL, query, and auth header handling.
FetchClient.prototype.fetch = async function (this: FetchClientInternals, url: string, init?: object) {
  const options = this.adjustOptionsForFormData(this.getFetchOptions(init))
  const fullUrl = new URL(this.getUrl(url, init), process.env.C8Y_BASEURL || DEFAULTS.baseUrl)
  return platform.fetch(new Request(fullUrl, options))
} as unknown as FetchClient['fetch']

beforeAll(() => {
  markRunning()
})

// Registered before any test file hook, so it runs first: the scope-aware
// arrange calls of the file and its describes replay after it.
beforeEach(async () => {
  platform.baseline = inject(PROVIDE_KEY) ?? {}
  platform.reset()
  // Imported lazily: loading c8y-nitro/utils before Nitro created the app
  // (in its own beforeAll) would enter Nitro's runtime through an import cycle.
  const { useSubscribedTenantCredentials, useTenantOptions } = await import('c8y-nitro/utils')
  await useSubscribedTenantCredentials.invalidate()
  await useTenantOptions.invalidateAll()
})

afterEach(() => {
  const unhandled = platform.unhandled
  platform.unhandled = []
  if (unhandled.length > 0 && platform.onUnhandledRequest === 'error') {
    throw new Error(unhandledMessage(unhandled))
  }
})

expect.extend({
  toHaveReceived(_received: unknown, pattern: string, options: { times?: number } = {}) {
    const route = compileRoute(pattern)
    const matching = platform.calls.filter((call) => matchRoute(route, call.method, splitPath(call.path)))
    const pass = options.times === undefined ? matching.length > 0 : matching.length === options.times
    const expected = options.times === undefined ? 'at least one request' : `${options.times} request(s)`
    const received = platform.calls.length > 0
      ? platform.calls.map((call) => `  ${call.method} ${call.path}`).join('\n')
      : '  (none)'
    return {
      pass,
      message: () => pass
        ? `expected no request matching ${pattern}, but got ${matching.length}`
        : `expected ${expected} matching ${pattern}, got ${matching.length}.\nRequests to the platform in this test:\n${received}`,
    }
  },
})
