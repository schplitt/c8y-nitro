import { describe, expect, it } from 'vitest'
import { c8y, definePersona, serverFetch } from 'c8y-nitro/testing'

// Seed the fake Cumulocity tenant: every test in this file starts with this pump
const pump = c8y.device({ name: 'Pump 1', externalIds: { c8y_Serial: 'SN-1' } })

// A user without roles. Without `as`, requests come from the operator in vitest.config.ts.
const visitor = definePersona({ userName: 'visitor', roles: [] })

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

  it('fails for callers without a valid login', async () => {
    // the platform rejects the caller; c8y-nitro turns that into a 500
    expect((await serverFetch('/pumps/SN-1', { as: null })).status).toBe(500)
  })

  it('requires the inventory role', async () => {
    const res = await serverFetch('/pumps/SN-1', { as: visitor })

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
