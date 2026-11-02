import { vi } from 'vitest'
import { serverFetch } from 'nitro'

/**
 * Dev and bootstrap environment a c8y-nitro dev server expects.
 */
export const completeEnv = {
  C8Y_DEVELOPMENT_TENANT: 't12345',
  C8Y_DEVELOPMENT_USER: 'someUser@example.com',
  C8Y_DEVELOPMENT_PASSWORD: '<password>',
  C8Y_BASEURL: 'https://someTenant.cumulocity.com/',
  C8Y_BOOTSTRAP_TENANT: 't12345',
  C8Y_BOOTSTRAP_USER: 'bootstrapUser',
  C8Y_BOOTSTRAP_PASSWORD: 'bootstrapPassword',
}

/**
 * Stubs the C8Y_* environment for the current test file. Call it at the top
 * level of the file: the Nitro app is created in `beforeAll`, after the stubs.
 *
 * @param overrides - Variables to change from {@link completeEnv}
 */
export function stubC8yEnv(overrides: Partial<typeof completeEnv> = {}) {
  for (const [key, value] of Object.entries({ ...completeEnv, ...overrides })) {
    vi.stubEnv(key, value)
  }
}

/**
 * Requests a route of the test file's Nitro app and parses the JSON body.
 *
 * @param path - Route path including query
 * @param init - Request options
 */
export async function fetchJson(path: string, init?: Parameters<typeof serverFetch>[1]) {
  const res = await serverFetch(path, init)
  const json = await res.json() as Record<string, any>
  return { res, json }
}

/**
 * Sleeps for the given time.
 *
 * @param ms - Milliseconds to wait
 */
export function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * Captures console output for the current test file. The server runs in the
 * test worker, so evlog's wide events and `console.log` calls from routes and
 * tasks land here. Call `clear()` in `afterEach` to scope output to one test.
 */
export function captureLogs() {
  const spies = (['log', 'info', 'warn', 'error'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {}),
  )

  return {
    output: () => spies
      .flatMap((spy) => spy.mock.calls)
      .map((args) => args.map(String).join(' '))
      .join('\n'),
    clear: () => spies.forEach((spy) => spy.mockClear()),
  }
}
