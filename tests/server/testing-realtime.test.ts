// A realtime trigger (fixture plugin realtime-overheating.ts) tested against
// the fake tenant: the service subscribes at startup, the test writes data,
// waits for the notifications to be processed, and checks the result.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { c8y } from 'c8y-nitro/testing'
import { fetchJson } from './utils'

const pump = c8y.device({ name: 'Pump 1' })

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
    // arranged (replayed) data is not a change: no notification
    c8y.seed({ measurements: [temperature(99)] })

    it('does not react to arranged data', async () => {
      await c8y.notifications.settled()

      expect(c8y.db.alarms.find()).toEqual([])
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
