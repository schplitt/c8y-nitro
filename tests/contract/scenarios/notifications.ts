import { expect } from 'vitest'
import type { Client } from '@c8y/client'
import type { ContractContext, ContractScenario } from '../helpers'
import { eventually, time } from '../helpers'

async function api(client: Client, method: string, path: string, body?: unknown) {
  const res = await client.core.fetch(path, { method, headers: { 'content-type': 'application/json', 'accept': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : undefined }
}

interface Received {
  api: string
  action: string
  source: string
  payload: any
}

/**
 * Collects notifications of a c8y-realtime handler.
 */
function collector() {
  const received: Received[] = []
  const record = (payload: any, notification: any) => {
    received.push({ api: notification.description.type, action: notification.action, source: notification.description.sourceId, payload })
  }
  return { received, record }
}

/**
 * Waits until the c8y-realtime subscriptions (named after the scenario) of a source exist, then gives the consumers a moment to connect.
 * @param context - The scenario context
 * @param sourceId - Source the subscriptions filter on
 * @param count - Subscriptions expected
 */
async function waitForConsumers(context: ContractContext, sourceId: string, count: number) {
  const { client, unique, settle } = context
  await eventually(async () => {
    const result = await api(client, 'GET', `/notification2/subscriptions?source=${sourceId}&pageSize=100`)
    expect(result.body.subscriptions.filter((item: { subscription: string }) => item.subscription.startsWith(unique)).length).toBeGreaterThanOrEqual(count)
  })
  await settle(2000)
}

export const notificationsScenarios: ContractScenario[] = [
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
    name: 'notification2: lookup by id, listing, filters, bulk delete',
    async run({ client, unique, tenant }) {
      const { data: first } = await client.inventory.create({ name: `ns1-${unique}`, c8y_IsDevice: {} })
      const { data: second } = await client.inventory.create({ name: `ns2-${unique}`, c8y_IsDevice: {} })
      const name = `lst${unique}`
      const create = async (body: Record<string, unknown>) => {
        const result = await api(client, 'POST', '/notification2/subscriptions', { subscription: name, subscriptionFilter: { apis: ['alarms'] }, ...body })
        expect(result.status, JSON.stringify(body)).toBe(201)
        return result.body
      }

      // the same name works for another source and for the tenant context
      const onFirst = await create({ context: 'mo', source: { id: first.id } })
      const onSecond = await create({ context: 'mo', source: { id: second.id } })
      const onTenant = await create({ context: 'tenant' })
      expect(onFirst).toMatchObject({ context: 'mo', subscription: name, source: { id: first.id }, subscriptionFilter: { apis: ['alarms'] }, nonPersistent: false })
      expect(onFirst.id).toEqual(expect.any(String))
      expect(onFirst.self).toEqual(expect.stringContaining(`/notification2/subscriptions/${onFirst.id}`))
      // a tenant subscription's source is the tenant itself
      expect(onTenant).toMatchObject({ context: 'tenant', subscription: name, source: { id: tenant } })

      // a source and subscription name pair is unique, whatever the filter
      const duplicate = await api(client, 'POST', '/notification2/subscriptions', { context: 'mo', subscription: name, source: { id: first.id }, subscriptionFilter: { apis: ['events'] } })
      expect(duplicate.status).toBe(409)
      expect(duplicate.body.error).toBe('reliable-notification/Duplicate')

      const fetched = await api(client, 'GET', `/notification2/subscriptions/${onFirst.id}`)
      expect(fetched.status).toBe(200)
      expect(fetched.body).toMatchObject({ id: onFirst.id, context: 'mo', subscription: name, source: { id: first.id }, subscriptionFilter: { apis: ['alarms'] }, nonPersistent: false })
      const missing = await api(client, 'GET', '/notification2/subscriptions/99999999')
      expect(missing.status).toBe(404)
      expect(missing.body.error).toBe('reliable-notification/Not Found')
      expect((await api(client, 'DELETE', '/notification2/subscriptions/99999999')).status).toBe(404)

      const ids = async (query: string) => {
        const result = await api(client, 'GET', `/notification2/subscriptions?pageSize=100&${query}`)
        expect(result.status, query).toBe(200)
        return result.body.subscriptions.map((item: { id: string }) => item.id).sort()
      }
      expect(await ids(`subscription=${name}`)).toEqual([onFirst.id, onSecond.id, onTenant.id].sort())
      expect(await ids(`subscription=${name}&context=mo`)).toEqual([onFirst.id, onSecond.id].sort())
      expect(await ids(`subscription=${name}&context=tenant`)).toEqual([onTenant.id])
      expect(await ids(`subscription=${name}&source=${second.id}`)).toEqual([onSecond.id])
      expect(await ids(`subscription=${name}&context=tenant&source=${first.id}`)).toEqual([])
      expect(await ids('source=99999999999')).toEqual([])
      expect(await ids(`subscription=nothing${unique}`)).toEqual([])

      // paging
      const page = (query: string) => api(client, 'GET', `/notification2/subscriptions?subscription=${name}&${query}`).then((result) => result.body)
      const firstPage = await page('pageSize=2&withTotalElements=true&withTotalPages=true')
      expect(firstPage.subscriptions).toHaveLength(2)
      expect(firstPage.statistics).toEqual({ currentPage: 1, pageSize: 2, totalElements: 3, totalPages: 2 })
      const secondPage = await page('pageSize=2&currentPage=2&withTotalElements=true')
      expect(secondPage.subscriptions).toHaveLength(1)
      expect(secondPage.statistics).toEqual({ currentPage: 2, pageSize: 2, totalElements: 3 })
      expect((await page('pageSize=2')).statistics).toEqual({ currentPage: 1, pageSize: 2 })

      // bulk delete by source, and by context together with a source
      expect((await api(client, 'DELETE', `/notification2/subscriptions?source=${second.id}`)).status).toBe(204)
      expect(await ids(`subscription=${name}`)).toEqual([onFirst.id, onTenant.id].sort())
      expect((await api(client, 'DELETE', `/notification2/subscriptions?context=tenant&source=${first.id}`)).status).toBe(204)
      expect(await ids(`subscription=${name}`)).toEqual([onFirst.id, onTenant.id].sort())
      expect((await api(client, 'DELETE', `/notification2/subscriptions?context=mo&source=${first.id}`)).status).toBe(204)
      expect(await ids(`subscription=${name}`)).toEqual([onTenant.id])
      expect((await api(client, 'GET', `/notification2/subscriptions/${onFirst.id}`)).status).toBe(404)
      expect((await api(client, 'DELETE', `/notification2/subscriptions/${onTenant.id}`)).status).toBe(204)
      expect(await ids(`subscription=${name}`)).toEqual([])
    },
  },
  {
    name: 'notification2: subscription validation and filter options',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `nv-${unique}`, c8y_IsDevice: {} })
      const post = (body: Record<string, unknown>) => api(client, 'POST', '/notification2/subscriptions', { context: 'mo', subscription: `val${unique}`, source: { id: device.id }, subscriptionFilter: { apis: ['alarms'] }, ...body })
      const bad = async (label: string, body: Record<string, unknown>, status = 422) => {
        const result = await post(body)
        expect(result.status, label).toBe(status)
        expect(result.body.error, label).toEqual(expect.any(String))
      }

      await bad('unknown source', { source: { id: '99999999999' } }, 404)
      await bad('tenant context with a source', { context: 'tenant' })
      await bad('missing context', { context: undefined })
      await bad('unknown context', { context: 'device' })
      await bad('mo context without source', { source: undefined })
      await bad('missing name', { subscription: undefined })
      await bad('name with a dash', { subscription: `a-b${unique}` })
      await bad('unknown api', { subscriptionFilter: { apis: ['bogus'] } })
      await bad('wildcard next to another api', { subscriptionFilter: { apis: ['*', 'alarms'] } })

      // a filter is optional, and may be empty or a wildcard
      for (const [label, filter] of [['no filter', undefined], ['empty apis', { apis: [] }], ['wildcard', { apis: ['*'] }], ['several apis', { apis: ['alarms', 'events', 'measurements', 'managedobjects', 'operations'] }]] as const) {
        const created = await post({ subscription: `f${label.replace(/\W/g, '')}${unique}`, subscriptionFilter: filter })
        expect(created.status, label).toBe(201)
        expect(created.body.subscriptionFilter, label).toEqual(filter)
      }

      // typeFilter, fragmentsToCopy, and nonPersistent are kept as given
      const configured = await post({ subscription: `cfg${unique}`, nonPersistent: true, fragmentsToCopy: ['c8y_Keep'], subscriptionFilter: { apis: ['alarms'], typeFilter: `'a' or 'b'` } })
      expect(configured.status).toBe(201)
      expect(configured.body).toMatchObject({ nonPersistent: true, fragmentsToCopy: ['c8y_Keep'], subscriptionFilter: { apis: ['alarms'], typeFilter: `'a' or 'b'` } })
      const listed = await api(client, 'GET', `/notification2/subscriptions/${configured.body.id}`)
      expect(listed.body).toMatchObject({ nonPersistent: true, fragmentsToCopy: ['c8y_Keep'], subscriptionFilter: { typeFilter: `'a' or 'b'` } })
    },
  },
  {
    name: 'notification2: tokens, and unsubscribing a consumer',
    verifies: ['unsubscribe-statuses'],
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `nt-${unique}`, c8y_IsDevice: {} })
      const name = `tok${unique}`
      const created = await api(client, 'POST', '/notification2/subscriptions', { context: 'mo', subscription: name, source: { id: device.id }, subscriptionFilter: { apis: ['alarms'] } })
      expect(created.status).toBe(201)
      const token = (body: Record<string, unknown>) => api(client, 'POST', '/notification2/token', body)

      const minted = await token({ subscription: name, subscriber: `c${unique}` })
      expect(minted.status).toBe(200)
      expect(minted.body.token).toEqual(expect.any(String))
      expect(minted.body.token.length).toBeGreaterThan(20)
      expect((await token({ subscription: name, subscriber: `c${unique}`, expiresInMinutes: 5 })).status).toBe(200)
      expect((await token({ subscription: name, subscriber: `c${unique}`, nonPersistent: true })).status).toBe(200)
      expect((await token({ subscription: name, subscriber: `c${unique}`, shared: true })).status).toBe(200)

      // the platform does not check that the subscription exists when it issues a token
      expect((await token({ subscription: `missing${unique}`, subscriber: `c${unique}` })).status).toBe(200)

      expect((await token({ subscription: name })).status).toBe(422)
      expect((await token({ subscriber: `c${unique}` })).status).toBe(422)
      expect((await token({})).status).toBe(422)
      expect((await token({ subscription: name, subscriber: `c-${unique}` })).status).toBe(422)

      // unsubscribing needs a token of a consumer that is connected right now
      expect((await api(client, 'POST', '/notification2/unsubscribe')).status).toBe(422)
      expect((await api(client, 'POST', '/notification2/unsubscribe?token=')).status).toBe(422)
      expect((await api(client, 'POST', '/notification2/unsubscribe?token=garbage')).status).toBe(500)
      expect((await api(client, 'POST', `/notification2/unsubscribe?token=${minted.body.token}`)).status).toBe(500)
      expect((await api(client, 'GET', `/notification2/subscriptions/${created.body.id}`)).status).toBe(200)
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
    name: 'realtime: notifications for events, operations, and created managed objects',
    async run(context) {
      const { client, unique, realtime } = context
      const { data: device } = await client.inventory.create({ name: `rte-${unique}`, c8y_IsDevice: {}, com_cumulocity_model_Agent: {} } as any)
      const { data: other } = await client.inventory.create({ name: `rto-${unique}`, c8y_IsDevice: {} })
      const { received, record } = collector()
      const rt = realtime()
      rt.events.onCreate(device.id, record)
      rt.events.onUpdate(device.id, record)
      rt.events.onDelete(device.id, record)
      rt.operations.onCreate(device.id, record)
      rt.operations.onUpdate(device.id, record)
      // tenant-wide: only the objects of this scenario
      rt.managedObjects.onCreate('*', (payload: any, notification: any) => {
        if (String(payload.name ?? '').includes(unique)) {
          record(payload, notification)
        }
      })
      await waitForConsumers(context, device.id, 2)
      await eventually(async () => {
        const result = await api(client, 'GET', `/notification2/subscriptions?context=tenant&subscription=${unique}Managedobjects`)
        expect(result.body.subscriptions).toHaveLength(1)
      })

      // events: create, update, delete (the delete payload is an opaque string, the id is in the description)
      const { body: event } = await api(client, 'POST', '/event/events', { source: { id: device.id }, type: `evt-${unique}`, text: 'created', time: new Date().toISOString() })
      await api(client, 'POST', '/event/events', { source: { id: other.id }, type: `evt-${unique}`, text: 'elsewhere', time: new Date().toISOString() })
      await eventually(async () => {
        expect(received).toContainEqual(expect.objectContaining({ api: 'events', action: 'CREATE', source: device.id, payload: expect.objectContaining({ id: event.id, type: `evt-${unique}`, text: 'created' }) }))
      }, 15_000)
      await api(client, 'PUT', `/event/events/${event.id}`, { text: 'changed' })
      await eventually(async () => {
        expect(received).toContainEqual(expect.objectContaining({ api: 'events', action: 'UPDATE', source: device.id, payload: expect.objectContaining({ id: event.id, text: 'changed' }) }))
      }, 15_000)
      await api(client, 'DELETE', `/event/events/${event.id}`)
      await eventually(async () => {
        const deletion = received.find((item) => item.api === 'events' && item.action === 'DELETE')
        expect(deletion?.source).toBe(device.id)
        expect(typeof deletion?.payload).toBe('string')
      }, 15_000)

      // operations: the source is the device; every status change is an update with the full operation
      const { body: operation } = await api(client, 'POST', '/devicecontrol/operations', { deviceId: device.id, c8y_Restart: {}, description: 'restart' })
      await eventually(async () => {
        expect(received).toContainEqual(expect.objectContaining({ api: 'operations', action: 'CREATE', source: device.id, payload: expect.objectContaining({ id: operation.id, deviceId: device.id, status: 'PENDING', description: 'restart' }) }))
      }, 15_000)
      await api(client, 'PUT', `/devicecontrol/operations/${operation.id}`, { status: 'EXECUTING' })
      await api(client, 'PUT', `/devicecontrol/operations/${operation.id}`, { status: 'FAILED', failureReason: 'Device offline' })
      await eventually(async () => {
        const updates = received.filter((item) => item.api === 'operations' && item.action === 'UPDATE').map((item) => item.payload)
        expect(updates).toContainEqual(expect.objectContaining({ id: operation.id, status: 'EXECUTING' }))
        expect(updates).toContainEqual(expect.objectContaining({ id: operation.id, status: 'FAILED', failureReason: 'Device offline' }))
      }, 15_000)

      // a created managed object is announced tenant-wide with its own id as the source
      const { data: created } = await client.inventory.create({ name: `rtn-${unique}`, c8y_IsDevice: {} })
      await eventually(async () => {
        expect(received).toContainEqual(expect.objectContaining({ api: 'managedobjects', action: 'CREATE', source: created.id, payload: expect.objectContaining({ id: created.id, name: `rtn-${unique}` }) }))
      }, 15_000)

      // nothing about the other device on the device's subscriptions
      expect(received.filter((item) => item.api !== 'managedobjects' && item.source !== device.id)).toEqual([])
    },
  },
  {
    name: 'realtime: typeFilter and fragmentsToCopy of the subscription are applied',
    async run(context) {
      const { client, unique, realtime, settle } = context
      const { data: device } = await client.inventory.create({ name: `rtf-${unique}`, c8y_IsDevice: {} })
      // c8y-realtime names its subscriptions <name><Api>; creating them first gives them a filter (its ensure accepts the 409)
      const create = (body: Record<string, unknown>) => api(client, 'POST', '/notification2/subscriptions', { context: 'mo', source: { id: device.id }, nonPersistent: true, ...body })
      expect((await create({ subscription: `${unique}Alarms`, subscriptionFilter: { apis: ['alarms'], typeFilter: `'keep1' or 'keep2'` } })).status).toBe(201)
      expect((await create({ subscription: `${unique}Events`, fragmentsToCopy: ['c8y_Keep'], subscriptionFilter: { apis: ['events'] } })).status).toBe(201)
      const { received, record } = collector()
      const rt = realtime()
      rt.alarms.onCreate(device.id, record)
      rt.alarms.onUpdate(device.id, record)
      rt.events.onCreate(device.id, record)
      await rt.start()
      await waitForConsumers(context, device.id, 2)

      // alarms of other types are dropped, for creations, deduplications, and updates alike
      const alarm = (type: string) => api(client, 'POST', '/alarm/alarms', { source: { id: device.id }, type, text: 'text', severity: 'MAJOR', time: new Date().toISOString() })
      await alarm('keep1')
      await alarm('drop')
      await alarm('keep2')
      await eventually(async () => {
        const creations = received.filter((item) => item.api === 'alarms' && item.action === 'CREATE')
        expect(creations.map((item) => item.payload.type)).toEqual(['keep1', 'keep2'])
      }, 15_000)
      await alarm('drop')
      await alarm('keep1')
      await eventually(async () => {
        expect(received).toContainEqual(expect.objectContaining({ api: 'alarms', action: 'UPDATE', payload: expect.objectContaining({ type: 'keep1', count: 2 }) }))
      }, 15_000)
      // a bulk update notifies every changed alarm
      expect((await api(client, 'PUT', `/alarm/alarms?source=${device.id}&status=ACTIVE`, { status: 'ACKNOWLEDGED' })).status).toBe(200)
      await eventually(async () => {
        const acknowledged = received.filter((item) => item.action === 'UPDATE' && item.payload.status === 'ACKNOWLEDGED').map((item) => item.payload.type)
        expect(acknowledged.sort()).toEqual(['keep1', 'keep2'])
      }, 15_000)
      await settle(1500)
      expect(received.filter((item) => item.payload.type === 'drop')).toEqual([])

      // only the named fragments are copied next to the standard ones
      await api(client, 'POST', '/event/events', { source: { id: device.id }, type: `evt-${unique}`, text: 'text', time: new Date().toISOString(), c8y_Keep: { a: 1 }, c8y_Other: { b: 2 } })
      await eventually(async () => {
        const created = received.find((item) => item.api === 'events' && item.action === 'CREATE')
        expect(created?.payload).toMatchObject({ type: `evt-${unique}`, text: 'text', c8y_Keep: { a: 1 }, source: { id: device.id } })
        expect(created?.payload.c8y_Other).toBeUndefined()
      }, 15_000)
    },
  },
  {
    name: 'realtime: a wildcard subscription delivers every API of the device',
    async run(context) {
      const { client, unique, realtime } = context
      const { data: device } = await client.inventory.create({ name: `rtw-${unique}`, c8y_IsDevice: {}, com_cumulocity_model_Agent: {} } as any)
      const { received, record } = collector()
      const rt = realtime()
      rt.onAny(device.id, record)
      await waitForConsumers(context, device.id, 1)
      const list = await api(client, 'GET', `/notification2/subscriptions?source=${device.id}&subscription=${unique}All`)
      expect(list.body.subscriptions).toHaveLength(1)
      expect(list.body.subscriptions[0].subscriptionFilter.apis).toEqual(['*'])

      await api(client, 'POST', '/measurement/measurements', { source: { id: device.id }, type: 'c8y_Temperature', time: new Date().toISOString(), c8y_Temperature: { T: { value: 21, unit: 'C' } } })
      await api(client, 'POST', '/event/events', { source: { id: device.id }, type: `evt-${unique}`, text: 'text', time: new Date().toISOString() })
      await api(client, 'POST', '/alarm/alarms', { source: { id: device.id }, type: `al-${unique}`, text: 'text', severity: 'MAJOR', time: time(1) })
      await api(client, 'POST', '/devicecontrol/operations', { deviceId: device.id, c8y_Restart: {} })
      await api(client, 'PUT', `/inventory/managedObjects/${device.id}`, { c8y_Notes: { text: 'updated' } })
      await eventually(async () => {
        const seen = received.map((item) => `${item.api}:${item.action}`)
        expect(seen).toEqual(expect.arrayContaining(['measurements:CREATE', 'events:CREATE', 'alarms:CREATE', 'operations:CREATE', 'managedobjects:UPDATE']))
        expect(received.every((item) => item.source === device.id)).toBe(true)
      }, 15_000)
    },
  },
]
