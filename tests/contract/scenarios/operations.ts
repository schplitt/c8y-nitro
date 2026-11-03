import { expect } from 'vitest'
import type { ContractScenario } from '../helpers'
import type { Client } from '@c8y/client'
import { rejection, sleep } from '../helpers'

async function api(client: Client, method: string, path: string, body?: unknown) {
  const res = await client.core.fetch(path, { method, headers: { 'content-type': 'application/json', 'accept': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : undefined }
}

const DAY = 86_400_000

export const operationsScenarios: ContractScenario[] = [
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
    name: 'operations: single operation, 404, unknown device, invalid bodies',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `os-${unique}`, c8y_IsDevice: {}, com_cumulocity_model_Agent: {} } as any)
      const created = await api(client, 'POST', '/devicecontrol/operations', { deviceId: device.id, c8y_Restart: {}, description: 'restart' })
      expect(created.status).toBe(201)
      expect(created.body).toMatchObject({ deviceId: device.id, deviceName: `os-${unique}`, status: 'PENDING', description: 'restart' })
      const id = created.body.id

      const fetched = await api(client, 'GET', `/devicecontrol/operations/${id}`)
      expect(fetched.status).toBe(200)
      expect(fetched.body).toMatchObject({ id, deviceId: device.id, status: 'PENDING', c8y_Restart: {}, description: 'restart' })
      // the platform adds the device name to created and updated operations and list items, but not to a single read
      expect(fetched.body.deviceName).toBeUndefined()

      const missing = await api(client, 'GET', '/devicecontrol/operations/99999999999')
      expect(missing.status).toBe(404)
      expect(missing.body.error).toBe('devicecontrol/Not Found')
      expect((await api(client, 'PUT', '/devicecontrol/operations/99999999999', { status: 'EXECUTING' })).status).toBe(404)

      const post = (body: Record<string, unknown>) => api(client, 'POST', '/devicecontrol/operations', body)
      expect((await post({ deviceId: '99999999999', c8y_Restart: {} })).status).toBe(422)
      expect((await post({ c8y_Restart: {} })).status).toBe(422)
      expect((await post({})).status).toBe(422)
      // an operation needs at least one property besides the device; the description counts
      expect((await post({ deviceId: device.id })).status).toBe(422)
      expect((await post({ deviceId: device.id, description: 'only a description' })).status).toBe(201)
      // the platform owns id, status, failureReason, and creationTime
      for (const field of [{ id: '5' }, { status: 'SUCCESSFUL' }, { failureReason: 'x' }, { creationTime: '2026-01-01T00:00:00.000Z' }]) {
        expect((await post({ deviceId: device.id, c8y_Restart: {}, ...field })).status, JSON.stringify(field)).toBe(422)
      }
    },
  },
  {
    name: 'operations: status transitions are unrestricted, failureReason and read-only fields',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `ot-${unique}`, c8y_IsDevice: {}, com_cumulocity_model_Agent: {} } as any)
      const { data: plain } = await client.inventory.create({ name: `ot2-${unique}`, c8y_IsDevice: {} })
      const { id } = (await api(client, 'POST', '/devicecontrol/operations', { deviceId: device.id, c8y_Config: { a: 1 }, description: 'before' })).body
      const put = (body: Record<string, unknown>) => api(client, 'PUT', `/devicecontrol/operations/${id}`, body)

      // any status can follow any other, even backwards
      for (const status of ['SUCCESSFUL', 'PENDING', 'EXECUTING', 'FAILED', 'SUCCESSFUL', 'PENDING']) {
        const result = await put({ status })
        expect(result.status, status).toBe(200)
        expect(result.body.status).toBe(status)
      }
      expect((await put({ status: 'BOGUS' })).status).toBe(422)
      expect((await api(client, 'GET', `/devicecontrol/operations/${id}`)).body.status).toBe('PENDING')
      expect((await put({ description: 'no status' })).status).toBe(422)

      // failureReason belongs to FAILED, and is dropped when the status moves on
      expect((await put({ status: 'SUCCESSFUL', failureReason: 'x' })).status).toBe(422)
      expect((await put({ status: 'FAILED', failureReason: 'Device offline' })).body).toMatchObject({ status: 'FAILED', failureReason: 'Device offline' })
      const recovered = await put({ status: 'SUCCESSFUL' })
      expect(recovered.body.status).toBe('SUCCESSFUL')
      expect(recovered.body.failureReason).toBeUndefined()

      // device, creation time are fixed; id, deviceName are ignored
      expect((await put({ status: 'EXECUTING', deviceId: plain.id })).status).toBe(422)
      expect((await put({ status: 'EXECUTING', creationTime: '2026-01-01T00:00:00.000Z' })).status).toBe(422)
      const ignored = await put({ status: 'EXECUTING', id: '5', deviceName: 'renamed' })
      expect(ignored.status).toBe(200)
      expect(ignored.body).toMatchObject({ id, deviceId: device.id, deviceName: `ot-${unique}` })

      // fragments are replaced as a whole, null removes one
      expect((await put({ status: 'EXECUTING', c8y_Config: { b: 2 }, description: 'after' })).body).toMatchObject({ c8y_Config: { b: 2 }, description: 'after' })
      expect((await api(client, 'GET', `/devicecontrol/operations/${id}`)).body.c8y_Config).toEqual({ b: 2 })
      const removed = await put({ status: 'EXECUTING', description: null })
      expect(removed.status).toBe(200)
      expect(removed.body.description).toBeUndefined()
    },
  },
  {
    name: 'operations: list ordering, revert, dates, fragmentType, paging',
    verifies: ['operations-status-filter-422', 'date-parameters-lenient'],
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `ol-${unique}`, c8y_IsDevice: {}, com_cumulocity_model_Agent: {} } as any)
      const created: Array<{ id: string, creationTime: string }> = []
      for (const fragment of ['c8y_A', 'c8y_B', 'c8y_C', 'c8y_D']) {
        created.push((await api(client, 'POST', '/devicecontrol/operations', { deviceId: device.id, [fragment]: {} })).body)
        await sleep(30)
      }
      const [a, b, c, d] = created.map((operation) => operation.id) as [string, string, string, string]
      const base = `/devicecontrol/operations?deviceId=${device.id}`
      const ids = async (query: string) => {
        const result = await api(client, 'GET', `${base}&pageSize=100&${query}`)
        expect(result.status, query).toBe(200)
        return result.body.operations.map((operation: { id: string }) => operation.id)
      }
      const before = new Date(Date.now() - DAY).toISOString()
      const after = new Date(Date.now() + DAY).toISOString()

      // oldest first; revert only takes effect together with a date range
      expect(await ids('')).toEqual([a, b, c, d])
      expect(await ids('revert=true')).toEqual([a, b, c, d])
      expect(await ids('revert=false')).toEqual([a, b, c, d])
      expect(await ids(`dateFrom=${before}`)).toEqual([a, b, c, d])
      expect(await ids(`dateFrom=${before}&revert=false`)).toEqual([a, b, c, d])
      expect(await ids(`dateFrom=${before}&revert=true`)).toEqual([d, c, b, a])
      expect(await ids(`dateTo=${after}&revert=true`)).toEqual([d, c, b, a])

      // dateFrom inclusive, dateTo exclusive, on the creation time
      expect(await ids(`dateFrom=${created[1]!.creationTime}`)).toEqual([b, c, d])
      expect(await ids(`dateTo=${created[1]!.creationTime}`)).toEqual([a])
      expect(await ids(`dateFrom=${after}`)).toEqual([])
      expect(await ids(`dateTo=${before}`)).toEqual([])
      expect((await api(client, 'GET', `${base}&dateFrom=garbage`)).status).toBe(422)

      expect(await ids('fragmentType=c8y_B')).toEqual([b])
      expect(await ids('fragmentType=c8y_Missing')).toEqual([])

      // status is a single value: lists and unknown values are rejected
      expect(await ids('status=PENDING')).toEqual([a, b, c, d])
      expect(await ids('status=FAILED')).toEqual([])
      expect((await api(client, 'GET', `${base}&status=PENDING,FAILED`)).status).toBe(422)
      expect((await api(client, 'GET', `${base}&status=BOGUS`)).status).toBe(422)

      // list items carry the device name
      const listed = await api(client, 'GET', `${base}&pageSize=1`)
      expect(listed.body.operations[0]).toMatchObject({ id: a, deviceName: `ol-${unique}` })
      const unknown = await api(client, 'GET', '/devicecontrol/operations?deviceId=99999999999')
      expect(unknown.status).toBe(200)
      expect(unknown.body.operations).toEqual([])

      // paging: totals only on request, the next link stops after the last page when totals are asked for
      const page = (query: string) => api(client, 'GET', `${base}&${query}`).then((result) => result.body)
      const first = await page('pageSize=3&currentPage=1&withTotalElements=true&withTotalPages=true')
      expect(first.statistics).toEqual({ currentPage: 1, pageSize: 3, totalElements: 4, totalPages: 2 })
      expect(first.operations.map((operation: { id: string }) => operation.id)).toEqual([a, b, c])
      expect(first.next).toEqual(expect.any(String))
      expect(first.prev).toBeUndefined()
      const second = await page('pageSize=3&currentPage=2&withTotalElements=true&withTotalPages=true')
      expect(second.operations.map((operation: { id: string }) => operation.id)).toEqual([d])
      expect(second.next).toBeUndefined()
      expect(second.prev).toEqual(expect.any(String))
      const beyond = await page('pageSize=3&currentPage=7&withTotalPages=true')
      expect(beyond.operations).toEqual([])
      expect(beyond.next).toBeUndefined()
      const plain = await page('pageSize=3&currentPage=2')
      expect(plain.statistics).toEqual({ currentPage: 2, pageSize: 3 })
      expect(plain.next).toEqual(expect.any(String))
      const partial = await page('pageSize=3&withTotalElements=true')
      expect(partial.statistics).toEqual({ currentPage: 1, pageSize: 3, totalElements: 4 })
    },
  },
]
