import { Buffer } from 'node:buffer'
import { EventBinaryService } from '@c8y/client'
import type { Client } from '@c8y/client'
import { expect } from 'vitest'
import type { ContractScenario } from '../helpers'
import { eventually, rejection, time } from '../helpers'

async function call(client: Client, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const raw = body === undefined || typeof body === 'string' || body instanceof Uint8Array
  const res = await client.core.fetch(path, {
    method,
    headers: { accept: 'application/json', ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : (raw ? body as any : JSON.stringify(body)),
  })
  const text = await res.clone().text()
  let json: any
  try {
    json = JSON.parse(text)
  } catch {}
  return { status: res.status, json, text, res }
}

const q = encodeURIComponent
function pause(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export const eventsScenarios: ContractScenario[] = [
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
    name: 'events: validation, unknown ids and attachments of unknown events',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `ev-${unique}`, c8y_IsDevice: {} })
      const post = (body: unknown) => call(client, 'POST', '/event/events', body)
      const valid = { source: { id: device.id }, type: `ev-${unique}`, text: 'text', time: time(1) }

      const noSource = await post({ ...valid, source: undefined })
      expect(noSource.status).toBe(422)
      expect(noSource.json.error).toBe('event/Invalid Data')
      for (const field of ['type', 'text', 'time']) {
        const res = await post({ ...valid, [field]: undefined })
        expect(res.status, field).toBe(422)
        expect(res.json.error).toBe('undefined/validationError')
        expect(res.json.message).toContain(field)
      }
      const unknownSource = await post({ ...valid, source: { id: '999999999999' } })
      expect(unknownSource.status).toBe(422)
      expect(unknownSource.json.error).toBe('event/Unprocessable Entity')

      for (const [method, path, body] of [
        ['GET', '/event/events/999999999999'],
        ['PUT', '/event/events/999999999999', { text: 'x' }],
        ['DELETE', '/event/events/999999999999'],
        ['GET', '/event/events/not-a-number'],
        ['GET', '/event/events/999999999999/binaries'],
        ['POST', '/event/events/999999999999/binaries', 'x'],
        ['DELETE', '/event/events/999999999999/binaries'],
      ] as const) {
        const res = await call(client, method, path, body, body === 'x' ? { 'content-type': 'text/plain' } : {})
        expect(res.status, `${method} ${path}`).toBe(404)
        expect(res.json.error).toBe('event/Not Found')
      }
      expect((await call(client, 'GET', `/event/events?source=${device.id}&dateFrom=foo`)).status).toBe(422)
      expect((await call(client, 'DELETE', `/event/events?source=${device.id}&dateFrom=foo`)).status).toBe(422)
    },
  },
  {
    name: 'events: detail, paging, totals, date range boundaries, revert',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `ep-${unique}`, c8y_IsDevice: {} })
      const created: any[] = []
      for (let minute = 1; minute <= 4; minute++) {
        created.push((await client.event.create({ source: { id: device.id }, type: `ev-${unique}`, text: `e${minute}`, time: time(minute) } as any)).data)
      }

      const { data: detail } = await client.event.detail(created[0].id)
      expect(detail).toMatchObject({ id: created[0].id, type: `ev-${unique}`, text: 'e1', time: time(1), source: { id: device.id } })
      expect(detail.creationTime).toBeDefined()
      expect(detail.lastUpdated).toBe(detail.creationTime)

      const list = async (params: string) => (await call(client, 'GET', `/event/events?source=${device.id}&${params}`)).json
      const texts = (page: any) => page.events.map((event: any) => event.text)
      await eventually(async () => {
        expect(texts(await list('pageSize=100'))).toEqual(['e4', 'e3', 'e2', 'e1'])
      })

      const page = await list('pageSize=2&currentPage=2&withTotalElements=true&withTotalPages=true')
      expect(texts(page)).toEqual(['e2', 'e1'])
      expect(page.statistics).toEqual({ pageSize: 2, currentPage: 2, totalElements: 4, totalPages: 2 })
      expect((await list('pageSize=2')).statistics).toEqual({ pageSize: 2, currentPage: 1 })
      expect(texts(await list('pageSize=2&currentPage=3&withTotalElements=true'))).toEqual([])

      // dateFrom is inclusive, dateTo exclusive
      expect(texts(await list(`dateFrom=${q(time(2))}&dateTo=${q(time(4))}`))).toEqual(['e3', 'e2'])
      expect(texts(await list(`dateFrom=${q(time(3))}`))).toEqual(['e4', 'e3'])
      expect(texts(await list(`dateTo=${q(time(3))}`))).toEqual(['e2', 'e1'])
      expect(texts(await list(`dateFrom=${q(time(2))}&dateTo=${q(time(2))}`))).toEqual(['e2'])
      expect(texts(await list(`dateFrom=${q(time(4))}&dateTo=${q(time(2))}`))).toEqual([])

      // revert: newest first by default; only revert=true with a date range gives oldest first
      const range = `dateFrom=${q(time(0))}&dateTo=${q(time(10))}`
      expect(texts(await list('revert=true'))).toEqual(['e4', 'e3', 'e2', 'e1'])
      expect(texts(await list('revert=false'))).toEqual(['e4', 'e3', 'e2', 'e1'])
      expect(texts(await list(`${range}&revert=true`))).toEqual(['e1', 'e2', 'e3', 'e4'])
      expect(texts(await list(`${range}&revert=false`))).toEqual(['e4', 'e3', 'e2', 'e1'])
    },
  },
  {
    name: 'events: update semantics and read-only fields',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `eu-${unique}`, c8y_IsDevice: {} })
      const { data: event } = await client.event.create({ source: { id: device.id }, type: `ev-${unique}`, text: 'one', time: time(1), c8y_Flag: {}, c8y_Obj: { a: 1, b: 2 } } as any)
      const put = (body: unknown) => call(client, 'PUT', `/event/events/${event.id}`, body)

      // read-only fields are rejected
      const source = await put({ source: { id: device.id } })
      expect(source.status).toBe(422)
      expect(source.json.message).toContain('source')
      for (const field of ['time', 'type', 'creationTime', 'lastUpdated']) {
        const res = await put({ [field]: field === 'type' ? 'other' : time(5) })
        expect(res.status, field).toBe(422)
        expect(res.json.message).toBe(`put.eventRepresentation.${field}: is not allowed here`)
      }
      const wrongId = await put({ id: '1' })
      expect(wrongId.status).toBe(422)
      expect(wrongId.json.message).toContain('same like in url')
      // self is ignored
      expect((await put({ self: 'http://example.invalid' })).status).toBe(200)

      // an empty update still bumps lastUpdated
      const before = (await client.event.detail(event.id!)).data.lastUpdated
      await pause(20)
      const empty = await put({})
      expect(empty.status).toBe(200)
      expect(empty.json.lastUpdated > before).toBe(true)
      expect(empty.json.creationTime).toBe(event.creationTime)

      // text null is ignored, an empty text is kept, fragments are replaced (not merged), null removes them
      expect((await put({ text: null })).json.text).toBe('one')
      expect((await put({ text: '' })).json.text).toBe('')
      expect((await put({ c8y_Obj: { c: 3 } })).json.c8y_Obj).toEqual({ c: 3 })
      const removed = await put({ c8y_Obj: null, c8y_Flag: null, c8y_N: [1, 2] })
      expect(removed.json).toMatchObject({ text: '', c8y_N: [1, 2], time: time(1), type: `ev-${unique}` })
      expect(removed.json.c8y_Obj).toBeUndefined()
      expect(removed.json.c8y_Flag).toBeUndefined()
      const stored = await call(client, 'GET', `/event/events/${event.id}`)
      expect(stored.json.c8y_Obj).toBeUndefined()

      expect((await call(client, 'PUT', `/event/events/${event.id}`, 'not json', { 'content-type': 'text/plain' })).status).toBe(415)
    },
  },
  {
    name: 'events: createdFrom/To and lastUpdatedFrom/To boundaries',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `et-${unique}`, c8y_IsDevice: {} })
      const make = async (text: string) => {
        const { data } = await client.event.create({ source: { id: device.id }, type: `ev-${unique}`, text, time: time(1) } as any)
        await pause(30)
        return data
      }
      const [first, second, third] = [await make('first'), await make('second'), await make('third')]
      const texts = async (params: string) => (await call(client, 'GET', `/event/events?source=${device.id}&pageSize=100&${params}`)).json.events.map((event: any) => event.text).sort()

      // from inclusive, to exclusive
      expect(await texts(`createdFrom=${q(third.creationTime!)}`)).toEqual(['third'])
      expect(await texts(`createdTo=${q(third.creationTime!)}`)).toEqual(['first', 'second'])
      expect(await texts(`createdFrom=${q(second.creationTime!)}&createdTo=${q(third.creationTime!)}`)).toEqual(['second'])
      expect(await texts(`lastUpdatedFrom=${q(third.lastUpdated!)}`)).toEqual(['third'])
      expect(await texts(`lastUpdatedTo=${q(third.lastUpdated!)}`)).toEqual(['first', 'second'])

      await pause(30)
      const { data: updated } = await client.event.update({ id: second.id, text: 'second-updated' } as any)
      expect(updated.lastUpdated! > third.lastUpdated!).toBe(true)
      expect(await texts(`lastUpdatedFrom=${q(third.lastUpdated!)}`)).toEqual(['second-updated', 'third'])
      expect(await texts(`lastUpdatedFrom=${q(updated.lastUpdated!)}`)).toEqual(['second-updated'])
      expect(await texts(`lastUpdatedTo=${q(second.lastUpdated!)}`)).toEqual(['first'])
      // creation time does not change with updates
      expect(await texts(`createdTo=${q(third.creationTime!)}`)).toEqual(['first', 'second-updated'])
      expect(first.id).toBeDefined()
    },
  },
  {
    name: 'events: attachment upload variants, content types, edge cases',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `eb-${unique}`, c8y_IsDevice: {} })
      const make = async (text: string) => String((await client.event.create({ source: { id: device.id }, type: `ev-${unique}`, text, time: time(1) } as any)).data.id)
      const attachment = (id: string) => client.core.fetch(`/event/events/${id}/binaries`)

      // nothing attached yet
      const plain = await make('plain')
      const none = await call(client, 'GET', `/event/events/${plain}/binaries`)
      expect(none.status).toBe(404)
      expect(none.json).toMatchObject({ error: 'event/Not Found', message: 'Attachment not found' })
      // deleting a missing attachment succeeds
      expect((await call(client, 'DELETE', `/event/events/${plain}/binaries`)).status).toBe(204)

      // raw upload: type from the content type, name is the event id
      const raw = await call(client, 'POST', `/event/events/${plain}/binaries`, 'hello', { 'content-type': 'text/plain' })
      expect(raw.status).toBe(201)
      expect(raw.json).toMatchObject({ source: plain, type: 'text/plain', name: plain })
      expect(raw.json.self).toContain(`/event/events/${plain}/binaries`)
      const downloaded = await attachment(plain)
      expect(downloaded.headers.get('content-type')).toContain('text/plain')
      expect(await downloaded.text()).toBe('hello')
      const duplicate = await call(client, 'POST', `/event/events/${plain}/binaries`, 'again', { 'content-type': 'text/plain' })
      expect(duplicate.status).toBe(409)
      expect(duplicate.json.error).toBe('event/Duplicate')
      // a raw JSON body is not an upload
      expect((await call(client, 'POST', `/event/events/${await make('json')}/binaries`, '{"a":1}', { 'content-type': 'application/json' })).status).toBe(400)

      // multipart: name and type come from the file part
      const multipartEvent = await make('multipart')
      const boundary = `boundary${unique}`
      const form = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="object"',
        'Content-Type: application/json',
        '',
        JSON.stringify({ name: 'data.csv', type: 'text/csv' }),
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="data.csv"',
        'Content-Type: text/csv',
        '',
        'a,b',
        `--${boundary}--`,
        '',
      ].join('\r\n')
      const multipart = await call(client, 'POST', `/event/events/${multipartEvent}/binaries`, form, { 'content-type': `multipart/form-data; boundary=${boundary}` })
      expect(multipart.status).toBe(201)
      expect(multipart.json).toMatchObject({ source: multipartEvent, type: 'text/csv', name: 'data.csv' })
      const csv = await attachment(multipartEvent)
      expect(csv.headers.get('content-type')).toContain('text/csv')
      expect(csv.headers.get('content-disposition')).toContain('data.csv')
      expect(await csv.text()).toBe('a,b')

      // PUT replaces, and creates when nothing is attached; binary data and the content type survive
      const bytes = new Uint8Array([0, 1, 2, 255, 254])
      const put = await call(client, 'PUT', `/event/events/${multipartEvent}/binaries`, bytes, { 'content-type': 'image/png' })
      expect(put.status).toBe(201)
      const replaced = await attachment(multipartEvent)
      expect(replaced.headers.get('content-type')).toContain('image/png')
      expect([...new Uint8Array(await replaced.arrayBuffer())]).toEqual([...bytes])
      const putFirst = await make('put-first')
      expect((await call(client, 'PUT', `/event/events/${putFirst}/binaries`, 'abc', { 'content-type': 'application/octet-stream' })).status).toBe(201)
      expect(await (await attachment(putFirst)).text()).toBe('abc')

      // empty body, missing content type, 2 MB
      const empty = await make('empty')
      expect((await call(client, 'POST', `/event/events/${empty}/binaries`, '', { 'content-type': 'text/plain' })).status).toBe(201)
      expect(await (await attachment(empty)).text()).toBe('')
      const noType = await make('no-type')
      const untyped = await call(client, 'POST', `/event/events/${noType}/binaries`, 'zz')
      expect(untyped.status).toBe(201)
      expect(untyped.json.type).toBe('text/plain;charset=UTF-8')
      const big = await make('big')
      const payload = new Uint8Array(2_000_000).fill(65)
      expect((await call(client, 'POST', `/event/events/${big}/binaries`, payload, { 'content-type': 'application/octet-stream' })).status).toBe(201)
      expect((await attachment(big).then((res) => res.arrayBuffer())).byteLength).toBe(2_000_000)

      // deleting the event deletes its attachment
      expect((await call(client, 'DELETE', `/event/events/${plain}`)).status).toBe(204)
      const orphan = await call(client, 'GET', `/event/events/${plain}/binaries`)
      expect(orphan.status).toBe(404)
      expect(orphan.json.message).toContain('No event for gid')
    },
  },
  {
    name: 'events: bulk delete filters (dateFrom, dateTo, createdFrom, createdTo, fragmentType)',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `ed-${unique}`, c8y_IsDevice: {} })
      for (const [minute, type, extra] of [[1, 'a', { c8y_Flag: {} }], [2, 'a', {}], [3, 'a', {}], [4, 'b', {}], [5, 'a', {}]] as const) {
        await client.event.create({ source: { id: device.id }, type: `${type}-${unique}`, text: `e${minute}`, time: time(minute), ...extra } as any)
      }
      const remaining = async () => (await call(client, 'GET', `/event/events?source=${device.id}&pageSize=100`)).json.events.map((event: any) => event.text).sort()
      const del = async (params: string) => {
        const res = await client.core.fetch(`/event/events?source=${device.id}&${params}`, { method: 'DELETE' })
        expect(res.status).toBe(204)
      }
      await eventually(async () => {
        expect(await remaining()).toEqual(['e1', 'e2', 'e3', 'e4', 'e5'])
      })

      // nothing matches: nothing is deleted
      await del('fragmentType=c8y_Nope')
      await del('createdTo=2000-01-01T00:00:00Z')
      await del(`createdFrom=${q(new Date(Date.now() + 86_400_000).toISOString())}`)
      await del(`createdFrom=2000-01-01T00:00:00Z&createdTo=2100-01-01T00:00:00Z&fragmentType=c8y_Nope`)
      await pause(1500)
      expect(await remaining()).toEqual(['e1', 'e2', 'e3', 'e4', 'e5'])

      await del('fragmentType=c8y_Flag')
      await eventually(async () => {
        expect(await remaining()).toEqual(['e2', 'e3', 'e4', 'e5'])
      })
      // dateFrom inclusive, dateTo exclusive
      await del(`dateFrom=${q(time(2))}&dateTo=${q(time(3))}`)
      await eventually(async () => {
        expect(await remaining()).toEqual(['e3', 'e4', 'e5'])
      })
      await del(`type=b-${unique}`)
      await eventually(async () => {
        expect(await remaining()).toEqual(['e3', 'e5'])
      })
      // equal bounds include that instant
      await del(`dateFrom=${q(time(3))}&dateTo=${q(time(3))}`)
      await eventually(async () => {
        expect(await remaining()).toEqual(['e5'])
      })
      // creation time range, combined with another filter
      await del(`createdFrom=2000-01-01T00:00:00Z&createdTo=2100-01-01T00:00:00Z&dateFrom=${q(time(5))}`)
      await eventually(async () => {
        expect(await remaining()).toEqual([])
      })
    },
  },
]
