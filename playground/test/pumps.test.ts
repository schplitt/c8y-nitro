import { serverFetch } from 'nitro'
import { describe, expect, it } from 'vitest'
import { c8y } from 'c8y-nitro/testing'

// Seed the fake Cumulocity tenant: every test in this file starts with this pump
const pump = c8y.device({ name: 'Pump 1', externalIds: { c8y_Serial: 'SN-1' } })

describe('GET /pumps/:serial', () => {
  c8y.seed({
    measurements: [
      { source: pump, type: 'c8y_Temperature', time: '2026-01-01T10:00:00Z', c8y_Temperature: { T: { value: 64, unit: 'C' } } },
      { source: pump, type: 'c8y_Temperature', time: '2026-01-01T11:00:00Z', c8y_Temperature: { T: { value: 71.5, unit: 'C' } } },
    ],
  })

  it('returns the pump with its latest temperature', async () => {
    const res = await serverFetch('/pumps/SN-1')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ name: 'Pump 1', temperature: 71.5 })
  })

  it('answers 404 for an unknown serial number', async () => {
    const res = await serverFetch('/pumps/SN-404')

    expect(res.status).toBe(404)
  })

  it('requires the inventory role', async () => {
    c8y.user({ userName: 'visitor', roles: [] })

    const res = await serverFetch('/pumps/SN-1')

    expect(res.status).toBe(403)
  })
})

describe('POST /pumps/:serial/check', () => {
  describe('when the pump is too hot', () => {
    c8y.seed({
      measurements: [{ source: pump, type: 'c8y_Temperature', c8y_Temperature: { T: { value: 95, unit: 'C' } } }],
    })

    it('raises a critical overheating alarm', async () => {
      const res = await serverFetch('/pumps/SN-1/check', { method: 'POST' })

      expect(await res.json()).toEqual({ temperature: 95, maxTemperature: 80, overheating: true })
      expect(c8y.db.alarms.find({ source: pump })).toMatchObject([
        { type: 'pump_Overheating', severity: 'CRITICAL', status: 'ACTIVE' },
      ])
    })

    it('respects the configured maximum temperature', async () => {
      c8y.tenantOptions.set('maxTemperature', '100')

      const res = await serverFetch('/pumps/SN-1/check', { method: 'POST' })

      expect((await res.json()).overheating).toBe(false)
      expect(c8y.db.alarms.find({ source: pump })).toEqual([])
    })
  })

  it('does not raise an alarm without measurements', async () => {
    const res = await serverFetch('/pumps/SN-1/check', { method: 'POST' })

    expect(await res.json()).toEqual({ temperature: null, maxTemperature: 80, overheating: false })
    expect(c8y.db.alarms.find()).toEqual([])
  })
})
