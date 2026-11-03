import { expect } from 'vitest'
import type { Client } from '@c8y/client'
import type { ContractScenario } from '../helpers'
import { rejection, time } from '../helpers'

async function api(client: Client, method: string, path: string, body?: unknown) {
  const res = await client.core.fetch(path, { method, headers: { 'content-type': 'application/json', 'accept': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : undefined }
}

export const platformScenarios: ContractScenario[] = [
  {
    name: 'current user and tenant',
    async run({ client, tenant }) {
      const user = await (await client.core.fetch('/user/currentUser')).json()
      expect(user.userName).toEqual(expect.any(String))
      expect(Array.isArray(user.effectiveRoles)).toBe(true)

      const current = await (await client.core.fetch('/tenant/currentTenant')).json()
      expect(current.name).toBe(tenant)
    },
  },
  {
    name: 'current user: id is the user name, roles carry id and name',
    async run({ client, tenant }) {
      const result = await api(client, 'GET', '/user/currentUser')
      expect(result.status).toBe(200)
      expect(result.body.id).toBe(result.body.userName)
      for (const role of result.body.effectiveRoles) {
        expect(role.id).toEqual(expect.any(String))
        expect(role.name).toBe(role.id)
      }

      const current = await api(client, 'GET', '/tenant/currentTenant')
      expect(current.status).toBe(200)
      expect(current.body.name).toBe(tenant)
      expect(current.body.domainName).toEqual(expect.stringContaining('.'))
    },
  },
  {
    name: 'validation: required fields are enforced',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `v-${unique}`, c8y_IsDevice: {} })
      const failure = await rejection(client.alarm.create({ source: { id: device.id }, type: 'x', text: 'no severity', time: time(1) } as any))
      expect(failure.res.status).toBe(422)
    },
  },
  {
    name: 'validation: every required field of alarm, event, measurement, and operation POST',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `vr-${unique}`, c8y_IsDevice: {}, com_cumulocity_model_Agent: {} } as any)
      const source = { id: device.id }
      const bodies: Record<string, { path: string, valid: Record<string, unknown> }> = {
        alarm: { path: '/alarm/alarms', valid: { source, type: `vr-${unique}`, text: 'text', severity: 'MAJOR', time: time(1) } },
        event: { path: '/event/events', valid: { source, type: `vr-${unique}`, text: 'text', time: time(1) } },
        measurement: { path: '/measurement/measurements', valid: { source, type: `vr-${unique}`, time: time(1) } },
        operation: { path: '/devicecontrol/operations', valid: { deviceId: device.id, c8y_Restart: {} } },
      }
      for (const [name, { path, valid }] of Object.entries(bodies)) {
        for (const field of Object.keys(valid)) {
          // c8y_Restart is the operation's payload: without it the body is invalid for another reason
          const { [field]: _removed, ...incomplete } = valid
          const result = await api(client, 'POST', path, incomplete)
          expect(result.status, `${name} without ${field}`).toBe(422)
          expect(result.body.error, `${name} without ${field}`).toEqual(expect.any(String))
          expect(result.body.message, `${name} without ${field}`).toEqual(expect.any(String))
        }
        expect((await api(client, 'POST', path, {})).status, `${name} empty`).toBe(422)
        expect((await api(client, 'POST', path, valid)).status, `${name} valid`).toBe(201)
      }
    },
  },
  {
    name: 'validation: unknown source, server-owned fields, unparsable time',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `vs-${unique}`, c8y_IsDevice: {}, com_cumulocity_model_Agent: {} } as any)
      const source = { id: device.id }
      const missing = { id: '99999999999' }
      const post = (path: string, body: Record<string, unknown>) => api(client, 'POST', path, body)

      // a source that does not exist: 404 for alarms, 422 for the others
      expect((await post('/alarm/alarms', { source: missing, type: 'x', text: 't', severity: 'MAJOR', time: time(1) })).status).toBe(404)
      expect((await post('/event/events', { source: missing, type: 'x', text: 't', time: time(1) })).status).toBe(422)
      expect((await post('/measurement/measurements', { source: missing, type: 'x', time: time(1) })).status).toBe(422)
      expect((await post('/devicecontrol/operations', { deviceId: missing.id, c8y_Restart: {} })).status).toBe(422)
      // a source without an id
      expect((await post('/alarm/alarms', { source: {}, type: 'x', text: 't', severity: 'MAJOR', time: time(1) })).status).toBe(422)

      // id and creationTime are the platform's: sending them is an error, not ignored
      const alarm = { source, type: `vs-${unique}`, text: 't', severity: 'MAJOR', time: time(1) }
      for (const field of [{ id: '5' }, { creationTime: time(2) }]) {
        expect((await post('/alarm/alarms', { ...alarm, ...field })).status, JSON.stringify(field)).toBe(422)
      }
      expect((await post('/event/events', { source, type: 'x', text: 't', time: time(1), id: '5' })).status).toBe(422)

      // a time that is no date is a parse error
      for (const [path, body] of [
        ['/alarm/alarms', { ...alarm, time: 'garbage' }],
        ['/event/events', { source, type: 'x', text: 't', time: 'garbage' }],
      ] as const) {
        expect((await post(path, body)).status, path).toBe(400)
      }
    },
  },
]
