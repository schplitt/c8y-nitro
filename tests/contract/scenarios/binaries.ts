import { Buffer } from 'node:buffer'
import { expect } from 'vitest'
import type { ContractScenario } from '../helpers'
import { eventually, rejection } from '../helpers'

type Json = Record<string, any>
type Client = Parameters<ContractScenario['run']>[0]['client']

async function getJson(client: Client, path: string): Promise<Json> {
  return await (await client.core.fetch(path)).json()
}

function query(params: Record<string, string | number | boolean>): string {
  return new URLSearchParams(Object.entries(params).map(([key, value]): [string, string] => [key, String(value)])).toString()
}

async function upload(client: Client, unique: string, fileName: string, content: string | Uint8Array, metadata: Json = {}): Promise<Json> {
  const { data, res } = await client.inventoryBinary.create(Buffer.from(content), { name: `${fileName}-${unique}`, fileName, ...metadata } as any)
  expect(res.status).toBe(201)
  return data
}

const UNKNOWN_ID = '99999999999'

export const binariesScenarios: ContractScenario[] = [
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
    // Verified against a real tenant (2026-11).
    name: 'inventory binaries: metadata, owner, and the download content type',
    async run({ client, unique }) {
      const { data: user } = await client.user.current()
      const bytes = new Uint8Array([0, 1, 2, 255])
      const typed = await upload(client, unique, 'typed.json', '{"a":1}', { type: 'text/plain' })
      // the stored content type comes from the file name, the type from the metadata
      expect(typed).toMatchObject({ name: `typed.json-${unique}`, type: 'text/plain', contentType: 'application/json', length: 7, owner: user.userName })
      expect(typed).toHaveProperty('c8y_IsBinary')
      expect(typed.id).toEqual(expect.any(String))
      const raw = await upload(client, unique, 'raw.bin', bytes)
      // without a type the client sends c8y_upload
      expect(raw).toMatchObject({ type: 'c8y_upload', length: 4 })

      // the download content type is the object's type when it is a media type, else octet-stream
      const typedDownload = await client.inventoryBinary.download(typed.id) as unknown as Response
      expect(typedDownload.headers.get('content-type')).toBe('text/plain')
      expect(await typedDownload.text()).toBe('{"a":1}')
      const rawDownload = await client.inventoryBinary.download(raw.id) as unknown as Response
      expect(rawDownload.headers.get('content-type')).toBe('application/octet-stream')
      expect(new Uint8Array(await rawDownload.arrayBuffer())).toEqual(bytes)
      const html = await upload(client, unique, 'page.txt', '<p>', { type: 'text/html' })
      expect((await client.inventoryBinary.download(html.id) as unknown as Response).headers.get('content-type')).toBe('text/html')

      // the owner can be set on upload
      const owned = await upload(client, unique, 'owned.txt', 'x', { owner: `someone-${unique}` })
      expect(owned.owner).toBe(`someone-${unique}`)

      // replacing the content sets type and content type from the request and answers 201 without a body
      const replaced = await client.core.fetch(`/inventory/binaries/${typed.id}`, { method: 'PUT', headers: { 'content-type': 'application/xml' }, body: '<a/>' })
      expect(replaced.status).toBe(201)
      expect(await replaced.text()).toBe('')
      const detail = await getJson(client, `/inventory/managedObjects/${typed.id}`)
      expect(detail).toMatchObject({ name: `typed.json-${unique}`, type: 'application/xml', contentType: 'application/xml', length: 4 })
      const download = await client.inventoryBinary.download(typed.id) as unknown as Response
      expect(download.headers.get('content-type')).toBe('application/xml')
      expect(await download.text()).toBe('<a/>')

      for (const binary of [typed, raw, html, owned]) {
        await client.inventoryBinary.delete(binary.id)
      }
    },
  },
  {
    // Verified against a real tenant (2026-11).
    name: 'inventory binaries: metadata through the inventory API, binaries as children',
    async run({ client, unique }) {
      const { data: parent } = await client.inventory.create({ name: `parent-${unique}` })
      const binary = await upload(client, unique, 'doc.txt', 'content')
      await client.inventory.childAssetsAdd(binary.id, parent.id)

      // the metadata can be updated through the inventory API, the content stays
      const { data: updated, res } = await client.inventory.update({ id: binary.id, extra: { a: 1 }, name: `renamed-${unique}` } as any)
      expect(res.status).toBe(200)
      expect(updated).toMatchObject({ extra: { a: 1 }, name: `renamed-${unique}`, length: 7 })
      expect(updated).toHaveProperty('c8y_IsBinary')
      expect(await (await client.inventoryBinary.download(binary.id) as unknown as Response).text()).toBe('content')

      // binaries are listed as children, and by the inventory list
      const children = await getJson(client, `/inventory/managedObjects/${parent.id}/childAssets`)
      expect(children.references.map((reference: Json) => reference.managedObject.id)).toEqual([binary.id])
      expect(children.references[0].managedObject).toHaveProperty('c8y_IsBinary')
      const listed = await client.inventory.list({ ids: binary.id, fragmentType: 'c8y_IsBinary' } as any)
      expect(listed.data.map((mo) => mo.id)).toEqual([binary.id])

      // deleting the binary removes it from its parent
      await client.inventoryBinary.delete(binary.id)
      await eventually(async () => {
        expect((await getJson(client, `/inventory/managedObjects/${parent.id}`)).childAssets.references).toEqual([])
      })
      expect((await client.core.fetch(`/inventory/binaries/${binary.id}`)).status).toBe(404)
    },
  },
  {
    // Verified against a real tenant (2026-11). Filters are tested one at a time: the platform
    // answers an empty list for several filters combined (for example type and owner).
    name: 'inventory binaries: list filters (ids, type, owner, child ids)',
    async run({ client, unique }) {
      const type = `bt-${unique}`
      const a = await upload(client, unique, 'a.txt', 'a', { type })
      const b = await upload(client, unique, 'b.txt', 'bb', { type })
      const c = await upload(client, unique, 'c.txt', 'ccc', { type: `other-${unique}` })
      await upload(client, unique, 'o.txt', 'o', { type, owner: `someone-${unique}` })
      const { data: parent } = await client.inventory.create({ name: `parent-${unique}` })
      await client.inventory.childAssetsAdd(a.id, parent.id)
      await client.inventory.childDevicesAdd(b.id, parent.id)
      await client.inventory.childAdditionsAdd(c.id, parent.id)
      const names = async (params: Record<string, string | number | boolean>) =>
        ((await getJson(client, `/inventory/binaries?${query({ pageSize: 100, ...params })}`)).managedObjects as Json[]).map((mo) => mo.name.replace(`-${unique}`, '')).sort()

      expect(await names({ type })).toEqual(['a.txt', 'b.txt', 'o.txt'])
      expect(await names({ type: `other-${unique}` })).toEqual(['c.txt'])
      // no wildcards in the type
      expect(await names({ type: `bt-*` })).toEqual([])
      expect(await names({ owner: `someone-${unique}` })).toEqual(['o.txt'])
      expect(await names({ owner: `nobody-${unique}` })).toEqual([])
      expect(await names({ ids: `${a.id},${c.id},${UNKNOWN_ID}` })).toEqual(['a.txt', 'c.txt'])
      expect(await names({ ids: UNKNOWN_ID })).toEqual([])
      // objects that are not binaries are not listed
      expect(await names({ ids: parent.id })).toEqual([])

      // the child id filters match nothing for binaries, in both directions
      await new Promise((resolve) => {
        setTimeout(resolve, 1500)
      })
      expect(await names({ childAssetId: parent.id })).toEqual([])
      expect(await names({ childDeviceId: parent.id })).toEqual([])
      expect(await names({ childAdditionId: parent.id })).toEqual([])
      expect(await names({ childAssetId: a.id })).toEqual([])
    },
  },
  {
    // Verified against a real tenant (2026-11): binary lists always carry totalPages, never totalElements.
    name: 'inventory binaries: paging statistics and links',
    async run({ client, unique }) {
      const type = `pg-${unique}`
      for (const name of ['a', 'b', 'c']) {
        await upload(client, unique, `${name}.txt`, name, { type })
      }
      const page = async (params: Record<string, string | number | boolean> = {}) => getJson(client, `/inventory/binaries?${query({ type, ...params })}`)
      const names = (result: Json) => result.managedObjects.map((mo: Json) => mo.name)

      // statistics always include the total pages; withTotalElements has no effect
      const defaults = await page()
      expect(defaults.statistics).toEqual({ currentPage: 1, pageSize: 5, totalPages: 1 })
      expect(names(defaults)).toHaveLength(3)
      expect(defaults.next).toBeUndefined()
      expect(defaults.prev).toBeUndefined()
      expect((await page({ withTotalElements: true, withTotalPages: true })).statistics).toEqual({ currentPage: 1, pageSize: 5, totalPages: 1 })
      expect((await page({ type: `none-${unique}` })).statistics).toEqual({ currentPage: 1, pageSize: 5, totalPages: 0 })

      // next only while more pages follow, prev from the second page on, also past the end
      const seen: string[] = []
      const first = await page({ pageSize: 1 })
      seen.push(...names(first))
      expect(first.statistics).toEqual({ currentPage: 1, pageSize: 1, totalPages: 3 })
      expect(first.next).toEqual(expect.any(String))
      expect(first.prev).toBeUndefined()
      const second = await page({ pageSize: 1, currentPage: 2 })
      seen.push(...names(second))
      expect(second.next).toEqual(expect.any(String))
      expect(second.prev).toEqual(expect.any(String))
      const third = await page({ pageSize: 1, currentPage: 3, withTotalPages: true })
      seen.push(...names(third))
      expect(third.next).toBeUndefined()
      expect(third.prev).toEqual(expect.any(String))
      expect(seen.sort()).toEqual([`a.txt-${unique}`, `b.txt-${unique}`, `c.txt-${unique}`])
      const beyond = await page({ pageSize: 1, currentPage: 4 })
      expect(beyond.managedObjects).toEqual([])
      expect(beyond.statistics).toMatchObject({ currentPage: 4, totalPages: 3 })
      expect(beyond.next).toBeUndefined()
      expect(beyond.prev).toEqual(expect.any(String))

      // a page size of 0 means 1, the maximum is 2000, a non-number is rejected
      expect((await page({ pageSize: 0 })).statistics).toMatchObject({ pageSize: 1, totalPages: 3 })
      expect((await page({ pageSize: 5000 })).statistics).toMatchObject({ pageSize: 2000, totalPages: 1 })
      const invalid = await client.core.fetch(`/inventory/binaries?${query({ type, pageSize: 'abc' })}`)
      expect(invalid.status).toBe(422)
      expect(await invalid.json()).toMatchObject({ message: 'Parameter \'pageSize\' must have an integer value!' })
    },
  },
  {
    // Verified against a real tenant (2026-11): binary ids answer 404, and the binaries API deletes any object.
    name: 'inventory binaries: unknown and non-binary ids, deleting through the binaries API',
    async run({ client, unique }) {
      const { data: plain } = await client.inventory.create({ name: `plain-${unique}` })
      const binary = await upload(client, unique, 'x.txt', 'x')
      const notFound = async (path: string, init?: Json) => {
        const response = await client.core.fetch(path, init)
        expect(response.status).toBe(404)
        expect((await response.json()).error).toBe('inventory/Not Found')
      }

      // read and replace need a binary: unknown ids and plain managed objects are not found
      await notFound(`/inventory/binaries/${UNKNOWN_ID}`)
      await notFound(`/inventory/binaries/${plain.id}`)
      await notFound(`/inventory/binaries/${UNKNOWN_ID}`, { method: 'PUT', headers: { 'content-type': 'text/plain' }, body: 'x' })
      await notFound(`/inventory/binaries/${plain.id}`, { method: 'PUT', headers: { 'content-type': 'text/plain' }, body: 'x' })
      await notFound(`/inventory/binaries/${UNKNOWN_ID}`, { method: 'DELETE' })
      // only GET, PUT, and DELETE exist on a binary
      expect((await client.core.fetch(`/inventory/binaries/${binary.id}`, { method: 'POST', body: 'x' })).status).toBe(405)

      // the binaries API deletes a plain managed object as well
      expect((await client.core.fetch(`/inventory/binaries/${plain.id}`, { method: 'DELETE' })).status).toBe(204)
      expect((await rejection(client.inventory.detail(plain.id))).res.status).toBe(404)

      // deleting twice
      await client.inventoryBinary.delete(binary.id)
      await notFound(`/inventory/binaries/${binary.id}`, { method: 'DELETE' })
      await notFound(`/inventory/binaries/${binary.id}`)
    },
  },
]
