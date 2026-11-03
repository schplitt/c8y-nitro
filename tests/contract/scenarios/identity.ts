import { expect } from 'vitest'
import type { Client } from '@c8y/client'
import type { ContractScenario } from '../helpers'
import { rejection } from '../helpers'

async function call(client: Client, method: string, path: string, body?: unknown) {
  const res = await client.core.fetch(path, {
    method,
    headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json: any
  try {
    json = JSON.parse(text)
  } catch {}
  return { status: res.status, json, text }
}

const q = encodeURIComponent

export const identityScenarios: ContractScenario[] = [
  {
    name: 'identity: create, read, idempotent re-create, conflict, list, delete',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `device-${unique}`, c8y_IsDevice: {} })
      const identity = { type: 'c8y_Serial', externalId: `SN-${unique}`, managedObject: { id: device.id } }

      const { res } = await client.identity.create(identity as any)
      expect(res.status).toBe(201)

      const { data } = await client.identity.detail({ type: 'c8y_Serial', externalId: `SN-${unique}` } as any)
      expect(data.managedObject!.id).toBe(device.id)

      // re-creating for the same object is idempotent, another object conflicts
      expect((await client.identity.create(identity as any)).res.status).toBe(201)
      const { data: other } = await client.inventory.create({ name: `other-${unique}`, c8y_IsDevice: {} })
      const conflict = await rejection(client.identity.create({ ...identity, managedObject: { id: other.id } } as any))
      expect(conflict.res.status).toBe(409)
      expect(conflict.data?.error).toBe('identity/Duplicate')

      const { data: list } = await client.identity.list(device.id)
      expect(list.map((entry) => entry.externalId)).toEqual([`SN-${unique}`])

      await client.identity.delete({ type: 'c8y_Serial', externalId: `SN-${unique}` } as any)
      expect((await rejection(client.identity.detail({ type: 'c8y_Serial', externalId: `SN-${unique}` } as any))).res.status).toBe(404)
    },
  },
  {
    name: 'identity: unknown ids and objects, validation, delete twice',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `idv-${unique}`, c8y_IsDevice: {} })

      const unknownValue = await call(client, 'GET', `/identity/externalIds/c8y_Serial/none-${unique}`)
      expect(unknownValue.status).toBe(404)
      expect(unknownValue.json.error).toBe('identity/Not Found')
      expect(unknownValue.json.message).toContain(`type=c8y_Serial, value=none-${unique}`)
      const unknownType = await call(client, 'GET', `/identity/externalIds/zz_${unique}/value`)
      expect(unknownType.status).toBe(404)
      expect(unknownType.json.error).toBe('identity/Not Found')
      expect((await call(client, 'DELETE', `/identity/externalIds/c8y_Serial/none-${unique}`)).status).toBe(404)

      // an unknown object has no external ids; binding to it fails
      const none = await call(client, 'GET', '/identity/globalIds/999999999999/externalIds')
      expect(none.status).toBe(200)
      expect(none.json.externalIds).toEqual([])
      const unbound = await call(client, 'POST', '/identity/globalIds/999999999999/externalIds', { type: 'c8y_Serial', externalId: `x-${unique}` })
      expect(unbound.status).toBe(404)
      expect(unbound.json.error).toBe('identity/Not Found')

      // type and externalId are required and must not be empty
      for (const [body, field] of [[{ externalId: `x-${unique}` }, 'type'], [{ type: 'c8y_Serial' }, 'externalId'], [{ type: 'c8y_Serial', externalId: '' }, 'externalId'], [{ type: '', externalId: `x-${unique}` }, 'type']] as const) {
        const res = await call(client, 'POST', `/identity/globalIds/${device.id}/externalIds`, body)
        expect(res.status, JSON.stringify(body)).toBe(422)
        expect(res.json.error).toBe('undefined/validationError')
        expect(res.json.message).toContain(field)
      }

      // delete twice
      await client.identity.create({ type: 'c8y_Serial', externalId: `A-${unique}`, managedObject: { id: device.id } } as any)
      expect((await call(client, 'DELETE', `/identity/externalIds/c8y_Serial/A-${unique}`)).status).toBe(204)
      const twice = await call(client, 'DELETE', `/identity/externalIds/c8y_Serial/A-${unique}`)
      expect(twice.status).toBe(404)
      expect(twice.json.error).toBe('identity/Not Found')
    },
  },
  {
    name: 'identity: several external ids per object, shape, case sensitivity, scoped by type',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `ids-${unique}`, c8y_IsDevice: {} })
      const { data: other } = await client.inventory.create({ name: `ids2-${unique}`, c8y_IsDevice: {} })
      const add = (id: string, type: string, externalId: string) => call(client, 'POST', `/identity/globalIds/${id}/externalIds`, { type, externalId })

      const created = await add(device.id, 'c8y_Serial', `A-${unique}`)
      expect(created.status).toBe(201)
      expect(created.json.type).toBe('c8y_Serial')
      expect(created.json.externalId).toBe(`A-${unique}`)
      expect(created.json.managedObject.id).toBe(device.id)
      expect(created.json.managedObject.self).toContain(`/inventory/managedObjects/${device.id}`)
      expect(created.json.self).toContain(`/identity/externalIds/c8y_Serial/A-${unique}`)
      expect((await add(device.id, 'c8y_Serial', `C-${unique}`)).status).toBe(201)
      expect((await add(device.id, `my_Type_${unique}`, `B-${unique}`)).status).toBe(201)
      // the same value under another type is a different external id, also for another object
      expect((await add(other.id, `my_Type_${unique}`, `A-${unique}`)).status).toBe(201)

      // the list has all ids of the object, of every type, without paging
      const list = await call(client, 'GET', `/identity/globalIds/${device.id}/externalIds?pageSize=2&currentPage=2`)
      expect(list.status).toBe(200)
      expect(list.json.self).toContain(`/identity/globalIds/${device.id}/externalIds`)
      expect(list.json.externalIds.map((entry: any) => `${entry.type}/${entry.externalId}`).sort()).toEqual([`c8y_Serial/A-${unique}`, `c8y_Serial/C-${unique}`, `my_Type_${unique}/B-${unique}`])
      expect(list.json.statistics).toBeUndefined()
      expect(list.json.externalIds.every((entry: any) => entry.managedObject.id === device.id)).toBe(true)
      expect((await client.identity.list(other.id)).data.map((entry) => entry.type)).toEqual([`my_Type_${unique}`])

      // type and value are case sensitive and matched exactly
      expect((await call(client, 'GET', `/identity/externalIds/c8y_serial/C-${unique}`)).status).toBe(404)
      expect((await call(client, 'GET', `/identity/externalIds/c8y_Serial/c-${unique}`)).status).toBe(404)
      expect((await call(client, 'GET', `/identity/externalIds/c8y_Serial/C-${unique}`)).json.managedObject.id).toBe(device.id)

      // deleting an external id leaves the others
      await call(client, 'DELETE', `/identity/externalIds/c8y_Serial/A-${unique}`)
      expect((await client.identity.list(device.id)).data).toHaveLength(2)

      // deleting the object removes its external ids
      await client.inventory.delete(device.id)
      expect((await call(client, 'GET', `/identity/externalIds/c8y_Serial/C-${unique}`)).status).toBe(404)
      expect((await call(client, 'GET', `/identity/globalIds/${device.id}/externalIds`)).json.externalIds).toEqual([])
    },
  },
  {
    name: 'identity: external ids with special characters',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `idx-${unique}`, c8y_IsDevice: {} })
      const value = `sp ace/slash?q=1&x#h%é+${unique}`
      const created = await call(client, 'POST', `/identity/globalIds/${device.id}/externalIds`, { type: 'c8y_Serial', externalId: value })
      expect(created.status).toBe(201)
      expect(created.json.externalId).toBe(value)
      expect(created.json.self).toContain(`/identity/externalIds/c8y_Serial/${q(value)}`)

      const detail = await call(client, 'GET', `/identity/externalIds/c8y_Serial/${q(value)}`)
      expect(detail.status).toBe(200)
      expect(detail.json.externalId).toBe(value)
      expect(detail.json.managedObject.id).toBe(device.id)
      // only the complete value matches
      expect((await call(client, 'GET', `/identity/externalIds/c8y_Serial/${q('sp ace')}`)).status).toBe(404)
      expect((await call(client, 'DELETE', `/identity/externalIds/c8y_Serial/${q(value)}`)).status).toBe(204)
      expect((await call(client, 'GET', `/identity/externalIds/c8y_Serial/${q(value)}`)).status).toBe(404)
    },
  },
]
