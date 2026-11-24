// A realtime trigger (fixture plugin realtime-overheating.ts) tested against
// the fake tenant: the service subscribes at startup, the test writes data,
// waits for the notifications to be processed, and checks the result.
import { createRequire } from 'node:module'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { serverFetch as nitroServerFetch } from 'nitro'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { c8y, serverFetch } from 'c8y-nitro/testing'
import { handledTemperatures } from './fixture/handled-temperatures'
import { serviceCloses } from './fixture/service-closes'
import { fetchJson, sleep } from './utils'

const pump = c8y.device({ name: 'Pump 1' })

// Nitro's Vitest environment (not exported by the package)
const nitroVitestEnvironment = createRequire(import.meta.url).resolve('nitro/vite').replace(/vite\.mjs$/, 'runtime/internal/vite/vitest-env.mjs')

const temperature = (value: number) => ({ source: pump, type: 'c8y_Temperature', c8y_Temperature: { T: { value, unit: 'C' } } })

describe('realtime triggers', () => {
  it('subscribes at startup', () => {
    expect(c8y.notifications.subscriptions()).toContainEqual(expect.objectContaining({
      context: 'tenant',
      subscriptionFilter: expect.objectContaining({ apis: ['measurements'] }),
    }))
  })

  it('listens at startup', () => {
    expect(c8y.notifications.consumers()).toEqual([expect.objectContaining({ tenant: c8y.tenant })])
  })

  it('raises an alarm when a measurement is too hot', async () => {
    c8y.seed({ measurements: [temperature(95)] })
    await c8y.notifications.settled()

    expect(c8y.db.alarms.find({ source: pump })).toMatchObject([{ type: 'c8y_Overheating', severity: 'CRITICAL', text: 'Temperature 95 °C' }])
  })

  it('ignores normal measurements', async () => {
    c8y.seed({ measurements: [temperature(60)] })
    await c8y.notifications.settled()

    expect(c8y.db.alarms.find()).toEqual([])
  })

  it('fails settled() when notifications are not processed within the timeout', async () => {
    // the handler's alarm request takes 100 ms: longer than the timeout
    c8y.override('POST /alarm/alarms', async ({ next }) => {
      await new Promise((resolve) => {
        setTimeout(resolve, 100)
      })
      return next()
    })
    c8y.seed({ measurements: [temperature(95)] })

    await expect(c8y.notifications.settled({ timeout: 50 })).rejects.toThrow(/^c8y\.notifications\.settled\(\): notifications still not processed after 50 ms \(.*(inflight|unacknowledged) [1-9]/)
    await c8y.notifications.settled()
  })

  it('does not wait for notifications of a subscription without a consumer', async () => {
    const { json } = await fetchJson('/platform/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenant: 't12345',
        method: 'POST',
        path: '/notification2/subscriptions',
        body: { context: 'tenant', subscription: 'noConsumer', subscriptionFilter: { apis: ['measurements'] } },
      }),
    })
    expect(json).toEqual({ status: 201 })

    c8y.seed({ measurements: [temperature(95)] })
    await c8y.notifications.settled({ timeout: 1000 })

    expect(c8y.db.alarms.find({ source: pump })).toMatchObject([{ type: 'c8y_Overheating' }])
  })

  it('waits for a listener a route opens lazily next to the startup listener', async () => {
    const tenant = c8y.tenant
    const before = c8y.notifications.consumers({ tenant }).length
    await fetchJson('/realtime-alarms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant }),
    })
    await expect.poll(() => c8y.notifications.consumers({ tenant }).length).toBe(before + 1)

    expect(before).toBe(1)
    expect(c8y.notifications.consumers({ tenant }).map((consumer) => consumer.subscription)).toEqual([
      expect.stringMatching(/Measurements$/),
      expect.stringMatching(/Alarms$/),
    ])
    c8y.seed({ alarms: [{ source: pump, type: 'c8y_Test', text: 'Test', severity: 'MINOR' }] })
    await c8y.notifications.settled()
  })

  it('keeps delivering past the token expiry, and a new service connects with a new token', async () => {
    const [startup] = c8y.notifications.consumers({ tenant: c8y.tenant })
    // tokens last one day by default: two days later the startup token has expired
    vi.setSystemTime(Date.now() + 2 * 24 * 60 * 60 * 1000)
    try {
      // the platform reads the faked clock: it no longer accepts the startup token
      const { json } = await fetchJson('/platform/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant: c8y.tenant, method: 'POST', path: `/notification2/unsubscribe?token=${startup!.token}` }),
      })
      expect(json).toEqual({ status: 500 })

      // the open listener stays open and keeps delivering
      expect(c8y.notifications.consumers({ tenant: c8y.tenant })).toEqual([startup])
      c8y.seed({ measurements: [temperature(95)] })
      await c8y.notifications.settled()
      expect(c8y.db.alarms.find({ source: pump })).toMatchObject([{ type: 'c8y_Overheating', text: 'Temperature 95 °C' }])

      // a new service connects with a new token
      await c8y.startService()
      const consumers = c8y.notifications.consumers({ tenant: c8y.tenant })
      expect(consumers).toEqual([expect.objectContaining({ token: expect.any(String) })])
      expect(consumers[0]!.token).not.toBe(startup!.token)
      c8y.seed({ measurements: [temperature(97)] })
      await c8y.notifications.settled()

      // a repeated active alarm is counted on the first one, not created again
      expect(c8y.db.alarms.find({ source: pump })).toMatchObject([{ type: 'c8y_Overheating', text: 'Temperature 95 °C', count: 2 }])
    } finally {
      vi.useRealTimers()
    }
  })

  describe('a realtime client the service created after startup', () => {
    c8y.subscriptions.add({ tenant: 't99999', user: 'service_t99999', password: 'pw' })

    it('does not block startService() inside the test, nor settled() for its leftover subscription', async () => {
      await fetchJson('/realtime-alarms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant: 't99999' }),
      })
      // the route opens its listener after it answered: poll for it
      await expect.poll(() => c8y.notifications.consumers({ tenant: 't99999' }).length).toBe(1)
      await c8y.notifications.settled()
      expect(c8y.notifications.subscriptions().map((item) => item.tenant)).toContain('t99999')

      await c8y.startService()

      // the t99999 subscription is still listed, without a listener
      expect(c8y.notifications.subscriptions().map((item) => item.tenant)).toContain('t99999')
      expect(c8y.notifications.consumers({ tenant: 't99999' })).toEqual([])
      const sensor = c8y.device({ name: 'Sensor', tenant: 't99999' })
      c8y.seed({ tenant: 't99999', alarms: [{ source: sensor, type: 'c8y_Test', text: 'Test', severity: 'MINOR' }] })
      await c8y.notifications.settled()

      // the startup plugin listens again on the new service
      expect(c8y.notifications.consumers({ tenant: c8y.tenant })).toHaveLength(1)
      c8y.seed({ measurements: [temperature(95)] })
      await c8y.notifications.settled()
      expect(c8y.db.alarms.find({ source: pump })).toMatchObject([{ type: 'c8y_Overheating' }])
    })
  })

  describe('with an existing hot measurement in the arranged data', () => {
    // a shared service listens already when the nested seed is replayed:
    // arranged (replayed) data is not a change, so no notification
    beforeAll(() => c8y.startService())

    describe('arranged after the service started', () => {
      c8y.seed({ measurements: [temperature(99)] })

      it('does not react to arranged data', async () => {
        await c8y.notifications.settled()

        expect(c8y.db.measurements.find({ source: pump })).toHaveLength(1)
        expect(c8y.db.alarms.find()).toEqual([])
      })
    })
  })
})

// Order-dependent on purpose: each pair checks what the next test sees.
describe('realtime state between tests', () => {
  const platformRequest = (request: { tenant: string, method: string, path: string, body?: unknown }) => fetchJson('/platform/request', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  })
  const subscriptionNames = () => c8y.notifications.subscriptions().map((item) => `${item.tenant}/${item.subscription}`).sort()

  // one service for these tests: its startup subscriptions stay connected
  beforeAll(() => c8y.startService())

  let startup: string[] = []

  it('starts with the subscriptions of the app startup', () => {
    startup = subscriptionNames()
    expect(startup).toEqual([expect.stringMatching(/^t12345\//)])
  })

  describe('a subscription a test creates in another tenant', () => {
    // a new service per test, so it reads the added subscription
    beforeEach(() => c8y.startService())
    c8y.subscriptions.add({ tenant: 't99999', user: 'service_t99999', password: 'pw' })

    it('is created', async () => {
      const { json } = await platformRequest({
        tenant: 't99999',
        method: 'POST',
        path: '/notification2/subscriptions',
        body: { context: 'tenant', subscription: 'testCreated', subscriptionFilter: { apis: ['alarms'] } },
      })

      expect(json).toEqual({ status: 201 })
      expect(subscriptionNames()).toContain('t99999/testCreated')
    })

    it('is gone in the next test', () => {
      expect(startup).not.toEqual([])
      expect(subscriptionNames()).toEqual(startup)
    })
  })

  describe('a startup subscription a test deletes', () => {
    it('is deleted', async () => {
      const [subscription] = c8y.notifications.subscriptions()
      const { json } = await platformRequest({ tenant: subscription!.tenant, method: 'DELETE', path: `/notification2/subscriptions/${subscription!.id}` })

      expect(json).toEqual({ status: 204 })
      expect(subscriptionNames()).not.toEqual(startup)
    })

    it('is back in the next test, and the service still gets its notifications', async () => {
      expect(startup).not.toEqual([])
      expect(subscriptionNames()).toEqual(startup)

      c8y.seed({ measurements: [temperature(97)] })
      await c8y.notifications.settled()

      expect(c8y.db.alarms.find({ source: pump })).toMatchObject([{ type: 'c8y_Overheating' }])
    })
  })
})

describe('a realtime client a route opens lazily in a shared service', () => {
  c8y.subscriptions.add({ tenant: 't99999', user: 'service_t99999', password: 'pw' })

  beforeAll(() => c8y.startService())

  let opened = false

  it('listens after the route opened it', async () => {
    await fetchJson('/realtime-alarms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant: 't99999' }),
    })
    await expect.poll(() => c8y.notifications.consumers({ tenant: 't99999' }).length).toBe(1)
    opened = true
  })

  // Order-dependent on purpose: checks what the previous test left behind, so
  // it fails when that test did not run. A client left open would reconnect
  // about 1 s after the reset, so wait longer.
  it('is closed in the next test', async () => {
    expect(opened).toBe(true)
    await sleep(1_500)

    expect(c8y.notifications.consumers({ tenant: 't99999' })).toEqual([])
  })
})

describe('c8y.stopService()', () => {
  it('lets the service catch up after an outage, in order', async () => {
    handledTemperatures.length = 0
    c8y.seed({ measurements: [temperature(91)] })
    await c8y.notifications.settled()
    expect(handledTemperatures).toEqual([91])

    await c8y.stopService()
    expect(c8y.notifications.consumers({ tenant: c8y.tenant })).toEqual([])
    // nobody listens
    c8y.seed({ measurements: [temperature(92)] })
    c8y.seed({ measurements: [temperature(93)] })

    await c8y.startService()
    await c8y.notifications.settled()
    expect(handledTemperatures).toEqual([91, 92, 93])
  })

  it('rejects serverFetch() while the service is stopped', async () => {
    await c8y.stopService()

    await expect(serverFetch('/hello')).rejects.toThrow('c8y-nitro/testing: the service is stopped (c8y.stopService(), or a start that failed). Call c8y.startService() first.')
    await expect(serverFetch('/hello', { as: { userName: 'nope' } })).rejects.toThrow('the service is stopped')
  })

  it('leaves no app for Nitro\'s own serverFetch() or its teardown to close again', async () => {
    const closes = serviceCloses.count
    await c8y.stopService()
    expect(serviceCloses.count).toBe(closes + 1)

    await expect(nitroServerFetch('/hello')).rejects.toThrow('Nitro instance is not available')
    // what Nitro's Vitest environment runs when the file ends
    const environment = (await import(pathToFileURL(nitroVitestEnvironment).href)).default as { setup: () => Promise<{ teardown: () => Promise<void> }> | { teardown: () => Promise<void> } }
    await (await environment.setup()).teardown()
    expect(serviceCloses.count).toBe(closes + 1)
  })

  it('marks the service stopped after a start that failed', async () => {
    process.env.FIXTURE_FAIL_STARTUP = '1'
    try {
      await expect(c8y.startService()).rejects.toThrow('fixture startup failure')
    } finally {
      delete process.env.FIXTURE_FAIL_STARTUP
    }

    await expect(serverFetch('/hello')).rejects.toThrow('the service is stopped')
    await c8y.stopService()
    await expect(serverFetch('/hello')).rejects.toThrow('the service is stopped')

    // a new app, with all plugins
    await c8y.startService()
    expect((await serverFetch('/hello')).status).toBe(200)
    expect(c8y.notifications.consumers({ tenant: c8y.tenant })).toHaveLength(1)
  })

  it('keeps the start error when closing the failed start throws too', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.env.FIXTURE_FAIL_STARTUP = '1'
    process.env.FIXTURE_CLOSE_FAILS = '1'
    let logged: unknown[][] = []
    try {
      await expect(c8y.startService()).rejects.toThrow('fixture startup failure')
      logged = [...errors.mock.calls]
    } finally {
      delete process.env.FIXTURE_FAIL_STARTUP
      delete process.env.FIXTURE_CLOSE_FAILS
      errors.mockRestore()
    }
    expect(logged).toContainEqual([expect.stringContaining('closing the service after its start failed threw too'), expect.objectContaining({ message: 'fixture close failure' })])

    await c8y.startService()
    expect((await serverFetch('/hello')).status).toBe(200)
  })

  it('does nothing on a second stop', async () => {
    const closes = serviceCloses.count
    await c8y.stopService()
    await c8y.stopService()
    expect(serviceCloses.count).toBe(closes + 1)
  })

  // Runs after a test that ended with a stopped service (and passes alone).
  it('gives the next test a new, running service', async () => {
    expect((await serverFetch('/hello')).status).toBe(200)
    expect(c8y.notifications.consumers({ tenant: c8y.tenant })).toHaveLength(1)
  })

  describe('not awaited, with a slow close hook', () => {
    let slowDone = 0
    let stopping: Promise<void> | undefined

    it('stops the service after the test ended', async () => {
      process.env.FIXTURE_SLOW_CLOSE = '300'
      try {
        await c8y.startService()
      } finally {
        delete process.env.FIXTURE_SLOW_CLOSE
      }
      slowDone = serviceCloses.slowDone
      // not awaited: the test ends while the close hook runs
      stopping = c8y.stopService()
    })

    // Runs after the test before (and passes alone): its stop ends before
    // this test's service starts, and does not close or reset it.
    it('gives the next test a new, running service', async () => {
      // the slow close hook ended before this test's service started
      expect(serviceCloses.slowDone).toBe(slowDone + (stopping ? 1 : 0))
      await stopping
      expect((await serverFetch('/hello')).status).toBe(200)
      expect(c8y.notifications.consumers({ tenant: c8y.tenant })).toHaveLength(1)
      c8y.seed({ measurements: [temperature(96)] })
      await c8y.notifications.settled()
      expect(handledTemperatures.at(-1)).toBe(96)
    })
  })

  describe('in beforeAll', () => {
    let beforeAllError: unknown
    beforeAll(async () => {
      beforeAllError = await c8y.stopService().catch((error: unknown) => error)
    })

    it('rejects', () => {
      expect(String(beforeAllError)).toContain('c8y.stopService() cannot be used in beforeAll() or afterAll(). Call it inside a test.')
    })
  })

  describe('while Vitest collects tests', () => {
    const collectError = c8y.stopService().catch((error: unknown) => error)

    it('rejects', async () => {
      expect(String(await collectError)).toContain('c8y.stopService() cannot be called while Vitest collects tests. Call it inside a test.')
    })
  })

  describe('in beforeEach', () => {
    beforeEach(async () => {
      await c8y.stopService()
    })

    it('runs the test on a stopped service', async () => {
      await expect(serverFetch('/hello')).rejects.toThrow('Call c8y.startService() first.')
      await c8y.startService()
      expect((await serverFetch('/hello')).status).toBe(200)
    })
  })

  describe('in afterEach', () => {
    // an assertion failing in afterEach fails the test
    afterEach(async () => {
      const afterEachError = await c8y.stopService().catch((error: unknown) => error)
      expect(String(afterEachError)).toContain('c8y.stopService() cannot be used after the test function ended (afterEach(), onTestFinished(), fixture teardown). Call it inside a test.')
      expect((await serverFetch('/hello')).status).toBe(200)
    })

    it('rejects', () => {})
  })

  // The test ends with a stopped service; an assertion failing in afterAll
  // fails the run.
  describe('serverFetch() in afterAll after a test that stopped the service', () => {
    let afterAllError: unknown
    afterAll(async () => {
      afterAllError = await serverFetch('/hello').catch((error: unknown) => error)
      expect(String(afterAllError)).toContain('the service is stopped (c8y.stopService(), or a start that failed). The next test starts a new service.')
    })

    it('stops the service', async () => {
      await c8y.stopService()
    })
  })
})
