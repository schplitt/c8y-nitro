import { describe, expect, it } from 'vitest'
import { c8y } from 'c8y-nitro/testing'

// The service subscribes to measurements at startup (plugins/overheating-trigger.ts).
const pump = c8y.device({ name: 'Pump 1' })

const temperature = (value: number) => ({ source: pump, type: 'c8y_Temperature', c8y_Temperature: { T: { value, unit: 'C' } } })

describe('overheating trigger', () => {
  it('raises an alarm when a pump reports a high temperature', async () => {
    // the device sends a measurement …
    c8y.seed({ measurements: [temperature(95)] })
    // … the service's realtime handler processes it …
    await c8y.notifications.settled()
    // … and the fake world contains the result
    expect(c8y.db.alarms.find({ source: pump })).toMatchObject([
      { type: 'pump_Overheating', severity: 'CRITICAL', text: 'Pump is at 95 °C (maximum 80 °C)' },
    ])
  })

  it('stays quiet below the maximum', async () => {
    c8y.seed({ measurements: [temperature(70)] })
    await c8y.notifications.settled()

    expect(c8y.db.alarms.find()).toEqual([])
  })

  it('uses the configured maximum', async () => {
    c8y.tenantOptions.set('maxTemperature', '100')

    c8y.seed({ measurements: [temperature(95)] })
    await c8y.notifications.settled()

    expect(c8y.db.alarms.find()).toEqual([])
  })
})
