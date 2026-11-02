/**
 * Contract scenarios for the c8y-nitro/testing fake tenant.
 *
 * Each scenario talks to "a Cumulocity tenant" through the real \@c8y/client
 * and asserts platform behavior the fake emulates. They run against the fake
 * in CI (tests/server/contract.test.ts). They only use a `Client` and create
 * their own uniquely named data, so the same scenarios can later run against a
 * real tenant to verify the fake. When a scenario fails there, the fake is
 * wrong.
 */
import { Buffer } from 'node:buffer'
import type { Client } from '@c8y/client'
import { EventBinaryService } from '@c8y/client'
import type { RealtimeClient } from 'c8y-realtime'
import { expect } from 'vitest'

export interface ContractContext {
  client: Client
  /**
   * Unique per scenario run, to keep data apart on a shared tenant.
   */
  unique: string
  /**
   * Tenant id of the credentials.
   */
  tenant: string
  /**
   * A c8y-realtime client for the same tenant and user (closed after the
   * scenario). Against the fake it uses the fake tenant's WebSocket.
   */
  realtime: () => RealtimeClient
}

export interface ContractScenario {
  name: string
  run: (context: ContractContext) => Promise<void>
}

async function rejection(promise: Promise<unknown>): Promise<{ res: { status: number }, data?: { error?: string } }> {
  try {
    await promise
  } catch (error) {
    return error as { res: { status: number }, data?: { error?: string } }
  }
  throw new Error('expected the request to fail')
}

/**
 * Retries an assertion for a few seconds: some platform writes (bulk deletes)
 * apply asynchronously on a real tenant. The fake applies them immediately.
 * @param assertion
 * @param timeout
 */
async function eventually(assertion: () => Promise<void>, timeout = 5000): Promise<void> {
  const start = Date.now()
  for (;;) {
    try {
      return await assertion()
    } catch (error) {
      if (Date.now() - start > timeout) {
        throw error
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 250)
      })
    }
  }
}

const time = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 10, minutes)).toISOString()

export const scenarios: ContractScenario[] = [
  {
    name: 'inventory: create, read, update (merge, null removes), delete',
    async run({ client, unique }) {
      const { data: created, res } = await client.inventory.create({ name: `mo-${unique}`, type: `type-${unique}`, c8y_A: { x: 1 }, c8y_B: {} } as any)
      expect(res.status).toBe(201)
      expect(created).toMatchObject({ name: `mo-${unique}`, c8y_A: { x: 1 } })
      expect(created.id).toEqual(expect.any(String))
      expect(created.creationTime).toEqual(expect.any(String))

      const { data: updated } = await client.inventory.update({ id: created.id, c8y_A: { x: 2 }, c8y_B: null } as any)
      expect(updated).toMatchObject({ name: `mo-${unique}`, c8y_A: { x: 2 } })
      expect(updated).not.toHaveProperty('c8y_B')

      const { data: detail } = await client.inventory.detail(created.id)
      expect(detail).toMatchObject({ c8y_A: { x: 2 } })

      await client.inventory.delete(created.id)
      expect((await rejection(client.inventory.detail(created.id))).res.status).toBe(404)
    },
  },
  {
    name: 'inventory: list by type with paging',
    async run({ client, unique }) {
      for (const name of ['a', 'b', 'c']) {
        await client.inventory.create({ name: `${name}-${unique}`, type: `paged-${unique}` })
      }
      const first = await client.inventory.list({ type: `paged-${unique}`, pageSize: 2, withTotalPages: true })
      expect(first.data.map((mo) => mo.name)).toEqual([`a-${unique}`, `b-${unique}`])
      expect(first.paging).toMatchObject({ currentPage: 1, pageSize: 2, totalPages: 2 })

      const second = await first.paging!.next()
      expect(second.data.map((mo) => mo.name)).toEqual([`c-${unique}`])
    },
  },
  {
    name: 'inventory: query language subset ($filter, has, wildcards, $orderby)',
    async run({ client, unique }) {
      await client.inventory.create({ name: `alpha-${unique}`, type: `q-${unique}`, c8y_IsDevice: {} })
      await client.inventory.create({ name: `beta-${unique}`, type: `q-${unique}`, c8y_IsDevice: {} })
      await client.inventory.create({ name: `gamma-${unique}`, type: `q-${unique}` })

      const { data } = await client.inventory.list({ query: `$filter=(type eq 'q-${unique}' and has(c8y_IsDevice)) $orderby=name desc` })
      expect(data.map((mo) => mo.name)).toEqual([`beta-${unique}`, `alpha-${unique}`])

      const { data: wildcard } = await client.inventory.list({ query: `$filter=(name eq 'gam*${unique}')` })
      expect(wildcard.map((mo) => mo.name)).toEqual([`gamma-${unique}`])
    },
  },
  {
    // Verified against a real tenant (eu-latest, 2026-11) via the mc8yp MCP server.
    name: 'inventory: query language details',
    async run({ client, unique }) {
      const { data: group } = await client.inventory.create({ name: `group-${unique}`, type: 'c8y_DeviceGroup' })
      const { data: pump } = await client.inventory.create({ name: `Pump-${unique}`, type: `ql-${unique}`, c8y_IsDevice: {}, c8y_Position: { lng: 6.5 }, tags: ['a', 'b'], owners: [{ id: 'o1' }] } as any)
      await client.inventory.create({ name: `valve-${unique}`, type: `ql-${unique}`, c8y_IsDevice: {}, c8y_Flag: {} } as any)
      await client.inventory.childAssetsAdd(pump.id, group.id)
      const names = async (query: string, extra: Record<string, unknown> = {}) =>
        (await client.inventory.list({ query, pageSize: 100, ...extra })).data.map((mo) => mo.name).sort()

      // exact matches are case-sensitive, wildcards case-insensitive
      expect(await names(`$filter=(name eq 'pump-${unique}')`)).toEqual([])
      expect(await names(`$filter=(name eq 'PUMP-${unique.slice(0, 4)}*')`)).toEqual([`Pump-${unique}`])
      // decimals need a f/d suffix
      expect(await names(`$filter=(type eq 'ql-${unique}' and c8y_Position.lng gt 6.4d)`)).toEqual([`Pump-${unique}`])
      // eq matches array elements and objects in arrays
      expect(await names(`$filter=(tags eq 'b' and type eq 'ql-${unique}')`)).toEqual([`Pump-${unique}`])
      expect(await names(`$filter=(owners.id eq 'o1' and type eq 'ql-${unique}')`)).toEqual([`Pump-${unique}`])
      // hasany() and group membership
      expect(await names(`$filter=(type eq 'ql-${unique}' and hasany(c8y_Position,c8y_Flag))`)).toEqual([`Pump-${unique}`, `valve-${unique}`])
      expect(await names(`$filter=(bygroupid(${group.id}))`)).toEqual([`Pump-${unique}`])
      // type is ignored when a query is given
      expect(await names(`$filter=(name eq 'Pump-${unique}')`, { type: 'not-the-type' })).toEqual([`Pump-${unique}`])
      // unsupported operators are rejected
      expect((await rejection(client.inventory.list({ query: `$filter=(name ne 'x')` }))).res.status).toBe(422)
    },
  },
  {
    name: 'inventory: child devices and parent references',
    async run({ client, unique }) {
      const { data: parent } = await client.inventory.create({ name: `parent-${unique}` })
      const { data: child } = await client.inventory.create({ name: `child-${unique}`, c8y_IsDevice: {} })
      await client.inventory.childDevicesAdd(child.id, parent.id)

      const { data: children } = await client.inventory.childDevicesList(parent.id)
      expect(children.map((mo) => mo.id)).toEqual([child.id])

      // parent references only with withParents=true
      const { data: plain } = await client.inventory.detail(child.id)
      expect(plain.deviceParents.references).toEqual([])
      const { data: detail } = await client.inventory.detail(child.id, { withParents: true })
      expect(detail.deviceParents.references.map((reference: any) => reference.managedObject.id)).toEqual([parent.id])
    },
  },
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
    name: 'measurements: newest first, revert=false for oldest first',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `m-${unique}`, c8y_IsDevice: {} })
      for (const [minute, value] of [[1, 10], [3, 30], [2, 20]] as const) {
        await client.measurement.create({ source: { id: device.id }, type: 'c8y_Temperature', time: time(minute), c8y_Temperature: { T: { value, unit: 'C' } } } as any)
      }
      const values = (data: any[]) => data.map((measurement) => measurement.c8y_Temperature.T.value)

      const { data: newestFirst } = await client.measurement.list({ source: device.id, type: 'c8y_Temperature' })
      expect(values(newestFirst)).toEqual([30, 20, 10])

      const { data: oldestFirst } = await client.measurement.list({ source: device.id, dateFrom: time(0), dateTo: time(10), revert: false, pageSize: 2 })
      expect(values(oldestFirst)).toEqual([10, 20])
    },
  },
  {
    name: 'events: newest first, update, delete',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `e-${unique}`, c8y_IsDevice: {} })
      const { data: first } = await client.event.create({ source: { id: device.id }, type: `ev-${unique}`, text: 'first', time: time(1) } as any)
      await client.event.create({ source: { id: device.id }, type: `ev-${unique}`, text: 'second', time: time(2) } as any)

      const { data: list } = await client.event.list({ source: device.id, type: `ev-${unique}` })
      expect(list.map((event) => event.text)).toEqual(['second', 'first'])

      const { data: updated } = await client.event.update({ id: first.id, text: 'changed' } as any)
      expect(updated.text).toBe('changed')

      await client.event.delete(first.id!)
      expect((await client.event.list({ source: device.id, type: `ev-${unique}` })).data).toHaveLength(1)
    },
  },
  {
    name: 'alarms: deduplication while active, clearing, bulk update',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `a-${unique}`, c8y_IsDevice: {} })
      const alarm = { source: { id: device.id }, type: `al-${unique}`, text: 'Too hot', severity: 'MAJOR', time: time(1) }

      const { data: first } = await client.alarm.create(alarm as any)
      const { data: duplicate } = await client.alarm.create({ ...alarm, time: time(2) } as any)
      expect(duplicate.id).toBe(first.id)
      expect(duplicate.count).toBe(2)

      await client.alarm.update({ id: first.id, status: 'CLEARED' } as any)
      const { data: fresh } = await client.alarm.create({ ...alarm, time: time(3) } as any)
      expect(fresh.id).not.toBe(first.id)
      expect(fresh.count).toBe(1)

      await client.alarm.updateBulk({ status: 'ACKNOWLEDGED' } as any, { source: device.id, status: 'ACTIVE' } as any)
      const { data: acknowledged } = await client.alarm.list({ source: device.id, status: 'ACKNOWLEDGED' } as any)
      expect(acknowledged.map((item) => item.id)).toEqual([fresh.id])
    },
  },
  {
    name: 'operations: need an agent, PENDING on create, status updates, list by device and status',
    async run({ client, unique }) {
      const { data: plain } = await client.inventory.create({ name: `o-plain-${unique}`, c8y_IsDevice: {} })
      expect((await rejection(client.operation.create({ deviceId: plain.id, c8y_Restart: {} } as any))).res.status).toBe(422)

      const { data: device } = await client.inventory.create({ name: `o-${unique}`, c8y_IsDevice: {}, com_cumulocity_model_Agent: {} } as any)
      const { data: operation } = await client.operation.create({ deviceId: device.id, c8y_Restart: {} } as any)
      expect(operation.status).toBe('PENDING')

      await client.operation.update({ id: operation.id, status: 'EXECUTING' } as any)
      const { data: done } = await client.operation.update({ id: operation.id, status: 'SUCCESSFUL' } as any)
      expect(done.status).toBe('SUCCESSFUL')

      const { data: list } = await client.operation.list({ deviceId: device.id, status: 'SUCCESSFUL' } as any)
      expect(list.map((item) => item.id)).toEqual([operation.id])

      expect((await rejection(client.operation.update({ id: operation.id, status: 'DONE' } as any))).res.status).toBe(422)
    },
  },
  {
    name: 'measurements: series with aggregation, bulk delete',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `s-${unique}`, c8y_IsDevice: {} })
      for (const [minute, value] of [[1, 10], [20, 30], [70, 50]] as const) {
        await client.measurement.create({ source: { id: device.id }, type: 'c8y_Temperature', time: time(minute), c8y_Temperature: { T: { value, unit: 'C' } } } as any)
      }
      const range = { source: device.id, dateFrom: time(0), dateTo: time(120) }

      const { data: raw } = await client.measurement.listSeries({ ...range, series: 'c8y_Temperature.T' } as any)
      expect(raw.series).toEqual([{ name: 'T', type: 'c8y_Temperature', unit: 'C' }])
      expect(Object.values(raw.values)).toEqual([[{ min: 10, max: 10 }], [{ min: 30, max: 30 }], [{ min: 50, max: 50 }]])

      const { data: hourly } = await client.measurement.listSeries({ ...range, aggregationType: 'HOURLY' } as any)
      expect(hourly.values).toEqual({
        [time(0)]: [{ min: 10, max: 30 }],
        [time(60)]: [{ min: 50, max: 50 }],
      })

      // bulk delete boundaries must be full hours
      const unaligned = await client.core.fetch(`/measurement/measurements?source=${device.id}&dateTo=${encodeURIComponent(time(30))}`, { method: 'DELETE' })
      expect(unaligned.status).toBe(422)
      const res = await client.core.fetch(`/measurement/measurements?source=${device.id}&dateTo=${encodeURIComponent(time(60))}`, { method: 'DELETE' })
      expect(res.status).toBe(204)
      await eventually(async () => {
        expect((await client.measurement.list({ source: device.id })).data).toHaveLength(1)
      })
    },
  },
  {
    name: 'events: attachments and bulk delete',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `ea-${unique}`, c8y_IsDevice: {} })
      const { data: event } = await client.event.create({ source: { id: device.id }, type: `att-${unique}`, text: 'with file', time: time(1) } as any)
      const binaries = new EventBinaryService(client.core)

      const { res: uploaded } = await binaries.upload(Buffer.from('hello attachment'), event.id!)
      expect(uploaded.status).toBe(201)
      expect((await rejection(binaries.upload(Buffer.from('again'), event.id!))).res.status).toBe(409)
      const download = await binaries.download(event.id!)
      expect(await (download as unknown as Response).text()).toBe('hello attachment')

      await client.event.create({ source: { id: device.id }, type: `att-${unique}`, text: 'second', time: time(2) } as any)
      const res = await client.core.fetch(`/event/events?source=${device.id}&type=att-${unique}`, { method: 'DELETE' })
      expect(res.status).toBe(204)
      await eventually(async () => {
        expect((await client.event.list({ source: device.id })).data).toEqual([])
      })
    },
  },
  {
    name: 'inventory binaries: upload, download, list, delete',
    async run({ client, unique }) {
      const { data: binary, res } = await client.inventoryBinary.create(Buffer.from('file content'), { name: `file-${unique}.txt`, fileName: `file-${unique}.txt` } as any)
      expect(res.status).toBe(201)
      expect(binary).toMatchObject({ name: `file-${unique}.txt`, c8y_IsBinary: expect.anything(), length: 12 })

      const download = await client.inventoryBinary.download(binary.id!)
      expect(await (download as unknown as Response).text()).toBe('file content')

      const { data: list } = await client.inventoryBinary.list({ pageSize: 100 } as any)
      expect(list.map((item) => item.id)).toContain(binary.id)

      await client.inventoryBinary.delete(binary.id!)
      expect((await rejection(client.inventory.detail(binary.id!))).res.status).toBe(404)
    },
  },
  {
    name: 'notification2: subscriptions and tokens',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `n-${unique}`, c8y_IsDevice: {} })
      const subscription = { context: 'mo', subscription: `sub${unique}`, source: { id: device.id }, subscriptionFilter: { apis: ['measurements'] } }
      const post = (path: string, body: unknown) => client.core.fetch(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'accept': 'application/json' } })

      const created = await post('/notification2/subscriptions', subscription)
      expect(created.status).toBe(201)
      const { id } = await created.json()
      expect((await post('/notification2/subscriptions', subscription)).status).toBe(409)

      const list = await (await client.core.fetch(`/notification2/subscriptions?subscription=sub${unique}`)).json()
      expect(list.subscriptions.map((item: any) => item.id)).toEqual([id])

      const token = await (await post('/notification2/token', { subscription: `sub${unique}`, subscriber: `sub${unique}Consumer` })).json()
      expect(token.token).toEqual(expect.any(String))

      expect((await client.core.fetch(`/notification2/subscriptions/${id}`, { method: 'DELETE' })).status).toBe(204)
    },
  },
  {
    name: 'realtime: notifications for measurements, alarms, and managed objects',
    async run({ client, unique, realtime }) {
      const { data: device } = await client.inventory.create({ name: `rt-${unique}`, c8y_IsDevice: {} })
      const received: Array<{ api: string, action: string, source: string, payload: any }> = []
      const record = (payload: any, notification: any) => {
        received.push({ api: notification.description.type, action: notification.action, source: notification.description.sourceId, payload })
      }
      const rt = realtime()
      rt.measurements.onCreate(device.id, record)
      rt.alarms.onCreate(device.id, record)
      rt.alarms.onUpdate(device.id, record)
      rt.managedObjects.onUpdate(device.id, record)
      rt.managedObjects.onDelete(device.id, record)

      // the subscriptions exist, then give the consumers a moment to connect
      await eventually(async () => {
        const list = await (await client.core.fetch(`/notification2/subscriptions?source=${device.id}&pageSize=100`)).json()
        expect(list.subscriptions.length).toBeGreaterThanOrEqual(3)
      })
      await new Promise((resolve) => {
        setTimeout(resolve, 2000)
      })

      const { data: measurement } = await client.measurement.create({ source: { id: device.id }, type: 'c8y_Temperature', time: new Date().toISOString(), c8y_Temperature: { T: { value: 21, unit: 'C' } } } as any)
      await eventually(async () => {
        expect(received).toContainEqual(expect.objectContaining({ api: 'measurements', action: 'CREATE', source: device.id, payload: expect.objectContaining({ id: measurement.id, type: 'c8y_Temperature' }) }))
      }, 15_000)

      const alarm = { source: { id: device.id }, type: `rt-${unique}`, text: 'Too hot', severity: 'MAJOR', time: new Date().toISOString() }
      const { data: created } = await client.alarm.create(alarm as any)
      await client.alarm.create({ ...alarm, time: new Date().toISOString() } as any)
      await eventually(async () => {
        expect(received).toContainEqual(expect.objectContaining({ api: 'alarms', action: 'CREATE', source: device.id, payload: expect.objectContaining({ id: created.id }) }))
        // deduplication is published as an update with the new count
        expect(received).toContainEqual(expect.objectContaining({ api: 'alarms', action: 'UPDATE', payload: expect.objectContaining({ id: created.id, count: 2 }) }))
      }, 15_000)

      await client.inventory.update({ id: device.id, c8y_Notes: { text: 'updated' } } as any)
      await eventually(async () => {
        expect(received).toContainEqual(expect.objectContaining({ api: 'managedobjects', action: 'UPDATE', source: device.id, payload: expect.objectContaining({ c8y_Notes: { text: 'updated' } }) }))
      }, 15_000)

      await client.inventory.delete(device.id)
      await eventually(async () => {
        const deletion = received.find((item) => item.api === 'managedobjects' && item.action === 'DELETE')
        // the id is only in the description; the payload is an opaque string
        expect(deletion?.source).toBe(device.id)
        expect(typeof deletion?.payload).toBe('string')
      }, 15_000)
    },
  },
  {
    name: 'tenant options: upsert, bulk set, list, delete',
    async run({ client, unique }) {
      const category = `ctr${unique}`
      const json = { 'content-type': 'application/json', 'accept': 'application/json' }
      try {
        // PUT creates a missing option (c8y-nitro's useTenantOption().set() relies on it)
        const put = await client.core.fetch(`/tenant/options/${category}/alpha`, { method: 'PUT', headers: json, body: JSON.stringify({ value: 'one' }) })
        expect(put.status).toBe(200)
        expect(await (await client.core.fetch(`/tenant/options/${category}/alpha`)).json()).toMatchObject({ category, key: 'alpha', value: 'one' })

        const bulk = await client.core.fetch(`/tenant/options/${category}`, { method: 'PUT', headers: json, body: JSON.stringify({ beta: 'two', gamma: 'three' }) })
        expect(bulk.status).toBe(200)
        expect(await (await client.core.fetch(`/tenant/options/${category}`)).json()).toEqual({ alpha: 'one', beta: 'two', gamma: 'three' })

        expect((await client.core.fetch(`/tenant/options/${category}/alpha`, { method: 'DELETE' })).status).toBe(204)
        expect((await client.core.fetch(`/tenant/options/${category}/alpha`)).status).toBe(404)
      } finally {
        for (const key of ['alpha', 'beta', 'gamma']) {
          await client.core.fetch(`/tenant/options/${category}/${key}`, { method: 'DELETE' }).catch(() => {})
        }
      }
    },
  },
  {
    name: 'alarms: severity and resolved filters, acknowledged deduplication, unvalidated severity',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `al2-${unique}`, c8y_IsDevice: {} })
      const alarm = (type: string, severity: string) => ({ source: { id: device.id }, type, text: type, severity, time: time(1) })
      const { data: major } = await client.alarm.create(alarm(`major-${unique}`, 'MAJOR') as any)
      const { data: minor } = await client.alarm.create(alarm(`minor-${unique}`, 'MINOR') as any)

      const ids = async (filter: Record<string, unknown>) => (await client.alarm.list({ source: device.id, pageSize: 100, ...filter } as any)).data.map((item) => item.id).sort()
      expect(await ids({ severity: 'MAJOR' })).toEqual([major.id])

      await client.alarm.update({ id: major.id, status: 'ACKNOWLEDGED' } as any)
      const { data: again } = await client.alarm.create(alarm(`major-${unique}`, 'MAJOR') as any)
      expect(again.id).toBe(major.id)
      expect(again.count).toBe(2)
      expect(again.status).toBe('ACKNOWLEDGED')

      await client.alarm.update({ id: minor.id, status: 'CLEARED' } as any)
      expect(await ids({ resolved: true })).toEqual([minor.id])
      expect(await ids({ resolved: false })).toEqual([major.id])

      // the platform does not validate severity values
      const { res: unknown, data: stored } = await client.alarm.create(alarm(`bad-${unique}`, 'SEVERE') as any)
      expect(unknown.status).toBe(201)
      expect(stored.severity).toBe('SEVERE')
    },
  },
  {
    name: 'events: fragment and creation-time filters, update, attachment replace and delete',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `ev2-${unique}`, c8y_IsDevice: {} })
      const { data: flagged } = await client.event.create({ source: { id: device.id }, type: `ev-${unique}`, text: 'flagged', time: time(1), c8y_Flag: {} } as any)
      await client.event.create({ source: { id: device.id }, type: `ev-${unique}`, text: 'plain', time: time(2) } as any)

      const texts = async (filter: Record<string, unknown>) => (await client.event.list({ source: device.id, pageSize: 100, ...filter } as any)).data.map((item) => item.text).sort()
      expect(await texts({ fragmentType: 'c8y_Flag' })).toEqual(['flagged'])
      expect(await texts({ createdFrom: '2000-01-01T00:00:00Z' })).toEqual(['flagged', 'plain'])
      expect(await texts({ createdTo: '2000-01-01T00:00:00Z' })).toEqual([])

      const { data: updated } = await client.event.update({ id: flagged.id, text: 'changed', c8y_Extra: { a: 1 } } as any)
      expect(updated).toMatchObject({ text: 'changed', c8y_Flag: {}, c8y_Extra: { a: 1 } })

      const binaries = new EventBinaryService(client.core)
      await binaries.upload(Buffer.from('first'), flagged.id!)
      const replaced = await client.core.fetch(`/event/events/${flagged.id}/binaries`, { method: 'PUT', headers: { 'content-type': 'text/plain' }, body: 'second' })
      expect(replaced.status).toBe(201)
      expect(await (await binaries.download(flagged.id!) as unknown as Response).text()).toBe('second')
      await binaries.delete(flagged.id!)
      expect((await client.core.fetch(`/event/events/${flagged.id}/binaries`)).status).toBe(404)
    },
  },
  {
    name: 'inventory: assets, additions, createChild, remove, onlyRoots, text, paging past the end',
    async run({ client, unique }) {
      const { data: parent } = await client.inventory.create({ name: `root-${unique}`, type: `tree-${unique}` })
      const { data: asset } = await client.inventory.create({ name: `asset-${unique}`, type: `tree-${unique}` })
      const { data: addition } = await client.inventory.create({ name: `addition-${unique}`, type: `tree-${unique}` })
      await client.inventory.childAssetsAdd(asset.id, parent.id)
      await client.inventory.childAdditionsAdd(addition.id, parent.id)
      const { data: created } = await client.inventory.childDevicesCreate({ name: `created-${unique}`, type: `tree-${unique}`, c8y_IsDevice: {} } as any, parent.id)
      expect(created.name).toBe(`created-${unique}`)

      expect((await client.inventory.childAssetsList(parent.id)).data.map((mo) => mo.id)).toEqual([asset.id])
      expect((await client.inventory.childAdditionsList(parent.id)).data.map((mo) => mo.id)).toEqual([addition.id])
      expect((await client.inventory.childDevicesList(parent.id)).data.map((mo) => mo.id)).toEqual([created.id])

      const ids = [parent.id, asset.id, addition.id, created.id].join(',')
      // parent links are indexed asynchronously on the platform
      await eventually(async () => {
        const roots = await client.inventory.list({ ids, onlyRoots: true, pageSize: 100 } as any)
        expect(roots.data.map((mo) => mo.id)).toEqual([parent.id])
      })

      await client.inventory.childAssetsRemove(asset.id, parent.id)
      expect((await client.inventory.childAssetsList(parent.id)).data).toEqual([])

      // text search matches ANY token ("asset", the run id); a quoted value matches the phrase
      const anyToken = await client.inventory.list({ text: `asset-${unique}`, pageSize: 100 } as any)
      expect(anyToken.data.map((mo) => mo.id).sort()).toEqual([parent.id, asset.id, addition.id, created.id].sort())
      const phrase = await client.inventory.list({ text: `"asset-${unique}"`, pageSize: 100 } as any)
      expect(phrase.data.map((mo) => mo.id)).toEqual([asset.id])

      const past = await client.inventory.list({ type: `tree-${unique}`, pageSize: 2, currentPage: 99 } as any)
      expect(past.data).toEqual([])
      // the platform links a next page even past the end
      expect(past.paging?.nextPage).toBe(100)
    },
  },
  {
    name: 'measurements: collection create, value fragment filters, detail and delete, interval functions',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `m2-${unique}`, c8y_IsDevice: {} })
      const created = await client.core.fetch('/measurement/measurements', {
        method: 'POST',
        headers: { 'content-type': 'application/vnd.com.nsn.cumulocity.measurementcollection+json', 'accept': 'application/json' },
        body: JSON.stringify({
          measurements: [
            { source: { id: device.id }, type: 'c8y_Climate', time: time(1), c8y_Climate: { T: { value: 10, unit: 'C' }, H: { value: 40, unit: '%' } } },
            { source: { id: device.id }, type: 'c8y_Climate', time: time(2), c8y_Climate: { T: { value: 20, unit: 'C' } } },
            { source: { id: device.id }, type: 'c8y_Power', time: time(3), c8y_Power: { P: { value: 5, unit: 'W' } } },
          ],
        }),
      })
      expect(created.status).toBe(201)
      const { measurements } = await created.json()
      expect(measurements).toHaveLength(3)

      const types = async (filter: Record<string, unknown>) => (await client.measurement.list({ source: device.id, pageSize: 100, ...filter } as any)).data.map((item: any) => item.type).sort()
      expect(await types({ valueFragmentType: 'c8y_Climate' })).toEqual(['c8y_Climate', 'c8y_Climate'])
      expect(await types({ valueFragmentType: 'c8y_Climate', valueFragmentSeries: 'H' })).toEqual(['c8y_Climate'])

      // time series persistence: single measurements cannot be read, but deleted
      expect((await rejection(client.measurement.detail(measurements[2].id))).res.status).toBe(405)
      await client.measurement.delete(measurements[2].id)
      await eventually(async () => {
        expect(await types({})).toEqual(['c8y_Climate', 'c8y_Climate'])
      })

      const series = await (await client.core.fetch(`/measurement/measurements/series?source=${device.id}&dateFrom=${encodeURIComponent(time(0))}&dateTo=${encodeURIComponent(time(60))}&series=c8y_Climate.T&aggregationInterval=1h&aggregationFunction=avg&aggregationFunction=count`)).json()
      expect(Object.values(series.values)).toEqual([[{ avg: 15, count: 2 }]])

      const invalid = await client.core.fetch(`/measurement/measurements/series?source=${device.id}&dateFrom=${encodeURIComponent(time(0))}&dateTo=${encodeURIComponent(time(60))}&aggregationFunction=avg`)
      // the platform answers 422 (the docs say 400)
      expect(invalid.status).toBe(422)
    },
  },
  {
    name: 'inventory: query language hierarchy, not, or, multi-field order, dates',
    async run({ client, unique }) {
      const { data: group } = await client.inventory.create({ name: `g-${unique}`, type: `h-${unique}`, c8y_IsDeviceGroup: {} } as any)
      const { data: sub } = await client.inventory.create({ name: `s-${unique}`, type: `h-${unique}`, c8y_IsDeviceGroup: {} } as any)
      const { data: leaf } = await client.inventory.create({ name: `l-${unique}`, type: `h-${unique}`, c8y_IsDevice: {} } as any)
      await client.inventory.childAssetsAdd(sub.id, group.id)
      await client.inventory.childAssetsAdd(leaf.id, sub.id)
      const names = async (query: string) => (await client.inventory.list({ query, pageSize: 100 })).data.map((mo) => mo.name)

      expect((await names(`$filter=(isinhierarchyof(${group.id}))`)).sort()).toEqual([`g-${unique}`, `l-${unique}`, `s-${unique}`])
      expect((await names(`$filter=(isinhierarchyof(${sub.id}))`)).sort()).toEqual([`l-${unique}`, `s-${unique}`])
      expect(await names(`$filter=(type eq 'h-${unique}' and not(has(c8y_IsDeviceGroup)))`)).toEqual([`l-${unique}`])
      expect((await names(`$filter=(name eq 'g-${unique}' or name eq 'l-${unique}')`)).sort()).toEqual([`g-${unique}`, `l-${unique}`])
      expect(await names(`$filter=(type eq 'h-${unique}') $orderby=c8y_IsDevice desc, name asc`)).toHaveLength(3)
      expect(await names(`$filter=(type eq 'h-${unique}' and creationTime.date gt '2000-01-01T00:00:00Z') $orderby=name desc`)).toEqual([`s-${unique}`, `l-${unique}`, `g-${unique}`])
      expect(await names(`$filter=(type eq 'h-${unique}' and creationTime.date lt '2000-01-01T00:00:00Z')`)).toEqual([])
    },
  },
  {
    name: 'operations: devices below an agent, failure reason, status filter',
    async run({ client, unique }) {
      const { data: agent } = await client.inventory.create({ name: `ag-${unique}`, c8y_IsDevice: {}, com_cumulocity_model_Agent: {} } as any)
      const { data: child } = await client.inventory.create({ name: `ch-${unique}`, c8y_IsDevice: {} })
      await client.inventory.childDevicesAdd(child.id, agent.id)

      const { data: operation } = await client.operation.create({ deviceId: child.id, c8y_Command: { text: 'reboot' } } as any)
      expect(operation.status).toBe('PENDING')

      const { data: failed } = await client.operation.update({ id: operation.id, status: 'FAILED', failureReason: 'Device offline' } as any)
      expect(failed).toMatchObject({ status: 'FAILED', failureReason: 'Device offline' })

      const { data: list } = await client.operation.list({ deviceId: child.id, status: 'FAILED' } as any)
      expect(list.map((item) => item.id)).toEqual([operation.id])
      expect((await client.operation.list({ deviceId: child.id, status: 'PENDING' } as any)).data).toEqual([])
    },
  },
  {
    name: 'inventory binaries: replace content, no deletes through the inventory API',
    async run({ client, unique }) {
      const { data: binary } = await client.inventoryBinary.create(Buffer.from('version 1'), { name: `bin-${unique}.txt`, fileName: `bin-${unique}.txt` } as any)
      const replaced = await client.core.fetch(`/inventory/binaries/${binary.id}`, { method: 'PUT', headers: { 'content-type': 'text/plain' }, body: 'version 2' })
      expect(replaced.status).toBe(201)
      expect(await (await client.inventoryBinary.download(binary.id!) as unknown as Response).text()).toBe('version 2')

      // binaries cannot be deleted through the inventory API
      expect((await rejection(client.inventory.delete(binary.id!))).res.status).toBe(422)
      await client.inventoryBinary.delete(binary.id!)
      expect((await client.core.fetch(`/inventory/binaries/${binary.id}`)).status).toBe(404)
    },
  },
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
    name: 'validation: required fields are enforced',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `v-${unique}`, c8y_IsDevice: {} })
      const failure = await rejection(client.alarm.create({ source: { id: device.id }, type: 'x', text: 'no severity', time: time(1) } as any))
      expect(failure.res.status).toBe(422)
    },
  },
]
