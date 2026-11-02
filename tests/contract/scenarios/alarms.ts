import { expect } from 'vitest'
import type { Client } from '@c8y/client'
import type { ContractScenario } from '../helpers'
import { eventually, time } from '../helpers'

async function api(client: Client, method: string, path: string, body?: unknown) {
  const res = await client.core.fetch(path, { method, headers: { 'content-type': 'application/json', 'accept': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : undefined }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}
const DAY = 86_400_000

export const alarmsScenarios: ContractScenario[] = [
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
    name: 'alarms: single alarm, 404, read-only fields on update',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `ro-${unique}`, c8y_IsDevice: {} })
      const { data: other } = await client.inventory.create({ name: `ro2-${unique}`, c8y_IsDevice: {} })
      const created = await api(client, 'POST', '/alarm/alarms', { source: { id: device.id }, type: `ro-${unique}`, text: 'first', severity: 'MAJOR', time: time(1) })
      expect(created.status).toBe(201)
      const id = created.body.id

      const fetched = await api(client, 'GET', `/alarm/alarms/${id}`)
      expect(fetched.status).toBe(200)
      expect(fetched.body).toMatchObject({ id, type: `ro-${unique}`, text: 'first', status: 'ACTIVE', severity: 'MAJOR', count: 1, source: { id: device.id }, time: time(1) })
      // set by the platform only when the alarm is deduplicated
      expect(fetched.body.firstOccurrenceTime).toBeUndefined()

      const missing = await api(client, 'GET', '/alarm/alarms/99999999999')
      expect(missing.status).toBe(404)
      expect(missing.body.error).toBe('alarm/Not Found')
      expect((await api(client, 'PUT', '/alarm/alarms/99999999999', { status: 'CLEARED' })).status).toBe(404)

      // type, time, count, and the server-set timestamps are rejected, not ignored
      for (const field of [{ type: 'other' }, { time: time(30) }, { count: 99 }, { creationTime: time(3) }, { lastUpdated: time(3) }, { firstOccurrenceTime: time(3) }]) {
        expect((await api(client, 'PUT', `/alarm/alarms/${id}`, field)).status, JSON.stringify(field)).toBe(422)
      }
      // source, id, and self are silently ignored
      const ignored = await api(client, 'PUT', `/alarm/alarms/${id}`, { source: { id: other.id }, id: '5', self: 'x', text: 'second', severity: 'MINOR' })
      expect(ignored.status).toBe(200)
      expect(ignored.body).toMatchObject({ id, text: 'second', severity: 'MINOR', type: `ro-${unique}`, source: { id: device.id }, time: time(1), count: 1 })
      expect((await api(client, 'GET', `/alarm/alarms/${id}`)).body).toMatchObject({ id, text: 'second', source: { id: device.id } })
    },
  },
  {
    name: 'alarms: deduplication keeps text and severity, tracks count and first occurrence',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `dd-${unique}`, c8y_IsDevice: {} })
      const { data: other } = await client.inventory.create({ name: `dd2-${unique}`, c8y_IsDevice: {} })
      const post = async (extra: Record<string, unknown>, source = device.id) => (await api(client, 'POST', '/alarm/alarms', { source: { id: source }, type: `dd-${unique}`, text: 'first', severity: 'MAJOR', time: time(1), ...extra })).body

      const first = await post({})
      expect(first.count).toBe(1)
      expect(first.firstOccurrenceTime).toBeUndefined()

      const second = await post({ time: time(5), text: 'changed', severity: 'CRITICAL' })
      expect(second).toMatchObject({ id: first.id, count: 2, text: 'first', severity: 'MAJOR', time: time(5), firstOccurrenceTime: time(1) })
      expect(await post({ time: time(6) })).toMatchObject({ id: first.id, count: 3, time: time(6), firstOccurrenceTime: time(1) })
      expect((await api(client, 'GET', `/alarm/alarms/${first.id}`)).body).toMatchObject({ count: 3, time: time(6), firstOccurrenceTime: time(1) })

      // another type or another source is another alarm
      expect((await post({ type: `dd-other-${unique}` })).id).not.toBe(first.id)
      expect((await post({}, other.id)).id).not.toBe(first.id)

      // a cleared alarm is not deduplicated into: the type is raised anew
      await client.alarm.update({ id: first.id, status: 'CLEARED' } as any)
      const raised = await post({ time: time(7) })
      expect(raised.id).not.toBe(first.id)
      expect(raised).toMatchObject({ count: 1, status: 'ACTIVE', time: time(7) })
      expect(raised.firstOccurrenceTime).toBeUndefined()
      expect((await api(client, 'GET', `/alarm/alarms/${first.id}`)).body).toMatchObject({ status: 'CLEARED', count: 3 })

      // alarms created as cleared are never merged
      const clearedOne = await post({ type: `cl-${unique}`, status: 'CLEARED' })
      const clearedTwo = await post({ type: `cl-${unique}`, status: 'CLEARED' })
      expect(clearedOne.status).toBe('CLEARED')
      expect(clearedTwo.id).not.toBe(clearedOne.id)
    },
  },
  {
    name: 'alarms: list by type list, dates, created, last updated, severity, status, paging',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `ls-${unique}`, c8y_IsDevice: {} })
      const { data: other } = await client.inventory.create({ name: `ls2-${unique}`, c8y_IsDevice: {} })
      const make = async (letter: string, minute: number, severity: string) => (await api(client, 'POST', '/alarm/alarms', { source: { id: device.id }, type: `${letter}-${unique}`, text: letter, severity, time: time(minute) })).body.id as string
      const a = await make('a', 1, 'MAJOR')
      const b = await make('b', 2, 'MINOR')
      const c = await make('c', 3, 'WARNING')
      const base = `/alarm/alarms?source=${device.id}`
      const ids = async (query: string) => {
        const result = await api(client, 'GET', `${base}&pageSize=100&${query}`)
        expect(result.status, query).toBe(200)
        return result.body.alarms.map((alarm: { id: string }) => alarm.id)
      }

      // newest alarm time first
      expect(await ids('')).toEqual([c, b, a])
      expect(await ids(`type=a-${unique},b-${unique}`)).toEqual([b, a])
      expect(await ids(`type=c-${unique}`)).toEqual([c])
      expect(await ids('severity=MINOR,WARNING')).toEqual([c, b])
      expect(await ids('status=ACTIVE,CLEARED')).toEqual([c, b, a])

      // dateFrom is inclusive, dateTo exclusive
      expect(await ids(`dateFrom=${time(2)}`)).toEqual([c, b])
      expect(await ids(`dateTo=${time(2)}`)).toEqual([a])
      expect(await ids(`dateFrom=${time(2)}&dateTo=${time(3)}`)).toEqual([b])
      // equal bounds select that exact time (the platform does not treat the range as empty)
      expect(await ids(`dateFrom=${time(2)}&dateTo=${time(2)}`)).toEqual([b])
      expect((await api(client, 'GET', `${base}&dateFrom=garbage`)).status).toBe(422)

      // creation time: the whole run is within a day of now
      const before = new Date(Date.now() - DAY).toISOString()
      const after = new Date(Date.now() + DAY).toISOString()
      expect(await ids(`createdFrom=${before}&createdTo=${after}`)).toHaveLength(3)
      expect(await ids(`createdFrom=${before}`)).toHaveLength(3)
      expect(await ids(`createdFrom=${after}`)).toEqual([])
      expect(await ids(`createdTo=${before}`)).toEqual([])

      // last update: updating one alarm moves it out of the earlier range
      await sleep(50)
      const updated = await api(client, 'PUT', `/alarm/alarms/${a}`, { text: 'updated' })
      const marker = updated.body.lastUpdated as string
      expect(await ids(`lastUpdatedFrom=${marker}`)).toEqual([a])
      expect(await ids(`lastUpdatedTo=${marker}`)).toEqual([c, b])
      expect(await ids(`lastUpdatedFrom=${before}&lastUpdatedTo=${after}`)).toHaveLength(3)

      // unknown source: nothing, not an error
      const none = await api(client, 'GET', '/alarm/alarms?source=99999999999')
      expect(none.status).toBe(200)
      expect(none.body.alarms).toEqual([])
      expect(await api(client, 'GET', `/alarm/alarms?source=${other.id}`).then((result) => result.body.alarms)).toEqual([])

      // paging: totals only on request, the next link stops after the last page when totals are asked for
      const page = (query: string) => api(client, 'GET', `${base}&${query}`).then((result) => result.body)
      const first = await page('pageSize=2&currentPage=1&withTotalElements=true&withTotalPages=true')
      expect(first.statistics).toEqual({ currentPage: 1, pageSize: 2, totalElements: 3, totalPages: 2 })
      expect(first.alarms.map((alarm: { id: string }) => alarm.id)).toEqual([c, b])
      expect(first.next).toEqual(expect.any(String))
      const second = await page('pageSize=2&currentPage=2&withTotalElements=true&withTotalPages=true')
      expect(second.alarms.map((alarm: { id: string }) => alarm.id)).toEqual([a])
      expect(second.next).toBeUndefined()
      expect(second.prev).toEqual(expect.any(String))
      const beyond = await page('pageSize=2&currentPage=9&withTotalPages=true')
      expect(beyond.alarms).toEqual([])
      expect(beyond.next).toBeUndefined()
      const plain = await page('pageSize=2&currentPage=2')
      expect(plain.statistics).toEqual({ currentPage: 2, pageSize: 2 })
      expect(plain.next).toEqual(expect.any(String))
      // page size and page number are clamped to at least 1
      const clamped = await page('pageSize=0&currentPage=0')
      expect(clamped.statistics).toMatchObject({ currentPage: 1, pageSize: 1 })
      expect(clamped.alarms).toHaveLength(1)
    },
  },
  {
    name: 'alarms: bulk update by severity, dates, created, resolved; only the status is applied',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `bk-${unique}`, c8y_IsDevice: {} })
      const make = async (letter: string, minute: number, severity: string) => (await api(client, 'POST', '/alarm/alarms', { source: { id: device.id }, type: `${letter}-${unique}`, text: 'original', severity, time: time(minute) })).body.id as string
      const a = await make('a', 1, 'MAJOR')
      const b = await make('b', 2, 'MINOR')
      const c = await make('c', 3, 'WARNING')
      const d = await make('d', 4, 'CRITICAL')
      const base = `/alarm/alarms?source=${device.id}`
      const statuses = async () => {
        const result = await api(client, 'GET', `${base}&pageSize=100`)
        return Object.fromEntries(result.body.alarms.map((alarm: { id: string, status: string }) => [alarm.id, alarm.status]))
      }
      const bulk = async (query: string, body: unknown) => {
        const result = await api(client, 'PUT', `${base}&${query}`, body)
        expect(result.status, query).toBe(200)
      }

      // the new status is mandatory, and the rest of the body is ignored
      expect((await api(client, 'PUT', base, { text: 'changed' })).status).toBe(422)
      expect((await api(client, 'PUT', `${base}&severity=MINOR`, { severity: 'CRITICAL' })).status).toBe(422)
      await bulk('severity=MINOR', { status: 'ACKNOWLEDGED', text: 'changed', severity: 'CRITICAL' })
      await eventually(async () => {
        expect(await statuses()).toEqual({ [a]: 'ACTIVE', [b]: 'ACKNOWLEDGED', [c]: 'ACTIVE', [d]: 'ACTIVE' })
      })
      const untouched = (await api(client, 'GET', `/alarm/alarms/${b}`)).body
      expect(untouched).toMatchObject({ text: 'original', severity: 'MINOR' })

      // dateFrom inclusive, dateTo exclusive
      await bulk(`dateFrom=${time(3)}&dateTo=${time(4)}`, { status: 'CLEARED' })
      await eventually(async () => {
        expect(await statuses()).toEqual({ [a]: 'ACTIVE', [b]: 'ACKNOWLEDGED', [c]: 'CLEARED', [d]: 'ACTIVE' })
      })

      // resolved=false covers every alarm that is not cleared
      await bulk('resolved=false', { status: 'ACKNOWLEDGED' })
      await eventually(async () => {
        expect(await statuses()).toEqual({ [a]: 'ACKNOWLEDGED', [b]: 'ACKNOWLEDGED', [c]: 'CLEARED', [d]: 'ACKNOWLEDGED' })
      })

      // created outside the window: nothing matches
      const before = new Date(Date.now() - DAY).toISOString()
      const after = new Date(Date.now() + DAY).toISOString()
      await bulk(`createdFrom=${after}`, { status: 'CLEARED' })
      await bulk(`createdTo=${before}`, { status: 'CLEARED' })
      await sleep(1500)
      expect(await statuses()).toEqual({ [a]: 'ACKNOWLEDGED', [b]: 'ACKNOWLEDGED', [c]: 'CLEARED', [d]: 'ACKNOWLEDGED' })

      // created inside the window, resolved=true: only the cleared alarm
      await bulk(`createdFrom=${before}&createdTo=${after}&resolved=true`, { status: 'ACKNOWLEDGED' })
      await eventually(async () => {
        expect(await statuses()).toEqual({ [a]: 'ACKNOWLEDGED', [b]: 'ACKNOWLEDGED', [c]: 'ACKNOWLEDGED', [d]: 'ACKNOWLEDGED' })
      })
    },
  },
]
