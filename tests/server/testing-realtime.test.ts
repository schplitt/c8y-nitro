// A realtime trigger (fixture plugin realtime-overheating.ts) tested against
// the fake tenant: the service subscribes at startup, the test writes data,
// waits for the notifications to be processed, and checks the result.
import { describe, expect, it } from 'vitest'
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

  describe('with an existing hot measurement in the arranged data', () => {
    // arranged (replayed) data is not a change: no notification
    c8y.seed({ measurements: [temperature(99)] })

    it('does not react to arranged data', async () => {
      await c8y.notifications.settled()

      expect(c8y.db.alarms.find()).toEqual([])
    })
  })

  it('deduplicates repeated alarms like the platform', async () => {
    c8y.seed({ measurements: [temperature(90), temperature(91)] })
    await c8y.notifications.settled()

    expect(c8y.db.alarms.find({ source: pump })).toMatchObject([{ count: 2 }])
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

  let startup: string[] = []

  it('starts with the subscriptions of the app startup', () => {
    startup = subscriptionNames()
    expect(startup.length).toBeGreaterThan(0)
  })

  describe('a subscription a test creates in another tenant', () => {
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

    it('is back in the next test', () => {
      expect(subscriptionNames()).toEqual(startup)
    })
  })
})
