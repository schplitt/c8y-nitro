// Tests a service against seeded platform data: arrange data, call the
// service, assert on its response and on the resulting platform state.
import { describe, expect, it } from 'vitest'
import { c8y } from 'c8y-nitro/testing'
import { fetchJson } from './utils'

const pump = c8y.device({ name: 'Pump 1', externalIds: { c8y_Serial: 'SN-1' } })
c8y.device({ name: 'Pump 2' })
c8y.device({ name: 'Valve' })
c8y.managedObject({ name: 'Pump group', type: 'c8y_DeviceGroup' })

describe('reading data', () => {
  it('finds a device by serial number', async () => {
    const { json } = await fetchJson('/devices/by-serial/SN-1')

    expect(json).toEqual({ id: pump.id, name: 'Pump 1' })
  })

  it('answers 500 for an unknown serial number', async () => {
    // identity answers 404; the c8y-client middleware turns it into a 500
    expect((await fetchJson('/devices/by-serial/unknown')).res.status).toBe(500)
  })

  it('lists devices by name prefix', async () => {
    const { json } = await fetchJson('/devices?prefix=Pump')

    expect(json.names).toEqual(['Pump 1', 'Pump 2'])
  })

  describe('with measurements', () => {
    c8y.seed({
      measurements: [
        { source: pump, type: 'c8y_Temperature', time: '2026-01-01T10:00:00Z', c8y_Temperature: { T: { value: 20, unit: 'C' } } },
        { source: pump, type: 'c8y_Temperature', time: '2026-01-01T11:00:00Z', c8y_Temperature: { T: { value: 23.5, unit: 'C' } } },
        { source: pump, type: 'c8y_Pressure', time: '2026-01-01T12:00:00Z', c8y_Pressure: { P: { value: 2, unit: 'bar' } } },
      ],
    })

    it('returns the latest temperature', async () => {
      expect((await fetchJson(`/devices/${pump.id}/temperature`)).json).toEqual({ temperature: 23.5 })
    })
  })

  it('returns no temperature without measurements', async () => {
    expect((await fetchJson(`/devices/${pump.id}/temperature`)).json).toEqual({ temperature: null })
  })
})

describe('writing data', () => {
  it('raises an alarm, and deduplicates it while active', async () => {
    await fetchJson(`/devices/${pump.id}/overheating`, { method: 'POST' })
    const { json } = await fetchJson(`/devices/${pump.id}/overheating`, { method: 'POST' })

    expect(json.count).toBe(2)
    expect(c8y.db.alarms.find({ source: pump, type: 'c8y_Overheating' })).toMatchObject([
      { severity: 'CRITICAL', status: 'ACTIVE', count: 2, source: { id: pump.id, name: 'Pump 1' } },
    ])
  })

  describe('operations', () => {
    // the platform only accepts operations for agents (or devices below one)
    const agent = c8y.device({ name: 'Agent pump', com_cumulocity_model_Agent: {} })

    it('creates a pending restart operation that a device can complete', async () => {
      const { json } = await fetchJson(`/devices/${agent.id}/restart`, { method: 'POST' })

      expect(json.status).toBe('PENDING')

      c8y.db.operations.update(json.operationId, { status: 'SUCCESSFUL' })
      expect(c8y.db.operations.find({ deviceId: agent })).toMatchObject([{ status: 'SUCCESSFUL', c8y_Restart: {}, deviceName: 'Agent pump' }])
    })

    it('rejects operations for devices without an agent', async () => {
      // 422 from the platform; the c8y-client middleware turns it into a 500
      expect((await fetchJson(`/devices/${pump.id}/restart`, { method: 'POST' })).res.status).toBe(500)
    })
  })
})

describe('relations', () => {
  const sensor = c8y.device({ name: 'Sensor' })
  const gateway = c8y.device({ name: 'Gateway', children: [sensor] })

  it('links children and parents', () => {
    expect(c8y.db.managedObjects.get(gateway)!.childDevices.references).toMatchObject([{ managedObject: { id: sensor.id, name: 'Sensor' } }])
    expect(c8y.db.managedObjects.get(sensor)!.deviceParents.references).toMatchObject([{ managedObject: { id: gateway.id } }])
  })
})

describe('binaries', () => {
  const manual = c8y.binary({ name: 'manual.txt', content: 'Turn it off and on again.' })

  it('serves seeded files to the service', async () => {
    expect((await fetchJson(`/files/${manual.id}`)).json).toEqual({ content: 'Turn it off and on again.' })
    expect(c8y.db.binaries.get(manual)).toMatchObject({ name: 'manual.txt', contentType: 'text/plain', length: 25 })
    expect(c8y.db.binaries.content(manual)!.text()).toBe('Turn it off and on again.')
  })
})

describe('multiple tenants', () => {
  c8y.subscriptions.add({ tenant: 't99999', user: 'service_t99999', password: 'pw' })
  c8y.device({ name: 'Other tenant pump', tenant: 't99999' })

  it('keeps data per tenant and answers each service user with its own tenant', async () => {
    const { json } = await fetchJson('/devices/count-per-tenant')

    // t12345 has the 3 file-level devices (binaries are not devices), t99999 only its own
    expect(json).toEqual({ t12345: 3, t99999: 1 })
    expect(c8y.db.tenant('t99999').managedObjects.find()).toMatchObject([{ name: 'Other tenant pump' }])
  })
})

describe('seeding errors', () => {
  it('validates seeds like the platform validates writes', () => {
    expect(() => c8y.seed({ events: [{ source: 'does-not-exist', type: 'x' }] })).toThrow(/Source with id 'does-not-exist' does not exist/)
    expect(() => c8y.seed({ operations: [{ deviceId: pump }] })).toThrow(/Agent for device .* does not exist in inventory/)
  })
})
