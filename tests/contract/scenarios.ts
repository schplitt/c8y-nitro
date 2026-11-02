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
import type { Client } from '@c8y/client'
import { expect } from 'vitest'

export interface ContractContext {
  client: Client
  /**
   * Unique per scenario run, to keep data apart on a shared tenant.
   */
  unique: string
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

      const { data: detail } = await client.inventory.detail(child.id)
      expect(detail.deviceParents.references.map((reference: any) => reference.managedObject.id)).toEqual([parent.id])
    },
  },
  {
    name: 'identity: create, read, conflict, list, delete',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `device-${unique}`, c8y_IsDevice: {} })
      const identity = { type: 'c8y_Serial', externalId: `SN-${unique}`, managedObject: { id: device.id } }

      const { res } = await client.identity.create(identity as any)
      expect(res.status).toBe(201)

      const { data } = await client.identity.detail({ type: 'c8y_Serial', externalId: `SN-${unique}` } as any)
      expect(data.managedObject!.id).toBe(device.id)

      expect((await rejection(client.identity.create(identity as any))).res.status).toBe(409)

      const { data: list } = await client.identity.list(device.id)
      expect(list.map((entry) => entry.externalId)).toEqual([`SN-${unique}`])

      await client.identity.delete({ type: 'c8y_Serial', externalId: `SN-${unique}` } as any)
      expect((await rejection(client.identity.detail({ type: 'c8y_Serial', externalId: `SN-${unique}` } as any))).res.status).toBe(404)
    },
  },
  {
    name: 'measurements: oldest first, revert for newest first in a range',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `m-${unique}`, c8y_IsDevice: {} })
      for (const [minute, value] of [[1, 10], [3, 30], [2, 20]] as const) {
        await client.measurement.create({ source: { id: device.id }, type: 'c8y_Temperature', time: time(minute), c8y_Temperature: { T: { value, unit: 'C' } } } as any)
      }
      const values = (data: any[]) => data.map((measurement) => measurement.c8y_Temperature.T.value)

      const { data: oldestFirst } = await client.measurement.list({ source: device.id, type: 'c8y_Temperature' })
      expect(values(oldestFirst)).toEqual([10, 20, 30])

      const { data: newestFirst } = await client.measurement.list({ source: device.id, dateFrom: time(0), dateTo: time(10), revert: true, pageSize: 2 })
      expect(values(newestFirst)).toEqual([30, 20])
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
    name: 'operations: PENDING on create, status updates, list by device and status',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `o-${unique}`, c8y_IsDevice: {} })
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
    name: 'validation: required fields are enforced',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `v-${unique}`, c8y_IsDevice: {} })
      const failure = await rejection(client.alarm.create({ source: { id: device.id }, type: 'x', text: 'no severity', time: time(1) } as any))
      expect(failure.res.status).toBe(422)
    },
  },
]
