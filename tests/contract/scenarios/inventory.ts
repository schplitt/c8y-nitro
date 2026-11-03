import { expect } from 'vitest'
import type { ContractContext, ContractScenario } from '../helpers'
import { eventually, rejection } from '../helpers'

type ContractClient = ContractContext['client']

type Json = Record<string, any>

async function getJson(client: ContractClient, path: string): Promise<Json> {
  return await (await client.core.fetch(path)).json()
}

function query(params: Record<string, string | number | boolean>): string {
  return new URLSearchParams(Object.entries(params).map(([key, value]): [string, string] => [key, String(value)])).toString()
}

const UNKNOWN_ID = '99999999999'

export const inventoryScenarios: ContractScenario[] = [
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
      // the order without $orderby is unspecified: compare the union of the pages
      const first = await client.inventory.list({ type: `paged-${unique}`, pageSize: 2, withTotalPages: true })
      expect(first.data).toHaveLength(2)
      expect(first.paging).toMatchObject({ currentPage: 1, pageSize: 2, totalPages: 2 })

      const second = await first.paging!.next()
      expect(second.data).toHaveLength(1)
      expect([...first.data, ...second.data].map((mo) => mo.name).sort()).toEqual([`a-${unique}`, `b-${unique}`, `c-${unique}`])
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
    verifies: ['query-ne-rejected', 'query-type-ignored'],
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
    // Verified against a real tenant (2026-11).
    name: 'inventory: owner is the calling user, settable on create and update',
    async run({ client, unique }) {
      const { data: user } = await client.user.current()
      const { data: mine } = await client.inventory.create({ name: `owned-${unique}`, type: `own-${unique}` })
      expect(mine.owner).toBe(user.userName)
      const { data: other } = await client.inventory.create({ name: `other-${unique}`, type: `own-${unique}`, owner: `someone-${unique}` } as any)
      expect(other.owner).toBe(`someone-${unique}`)

      const owned = async (owner: string) => (await client.inventory.list({ owner, text: unique, pageSize: 100 } as any)).data.map((mo) => mo.name)
      expect(await owned(user.userName!)).toEqual([`owned-${unique}`])
      expect(await owned(`someone-${unique}`)).toEqual([`other-${unique}`])
      expect(await owned(`nobody-${unique}`)).toEqual([])

      // owner and type can be changed by an update, the id in the body is ignored
      const { data: updated } = await client.inventory.update({ id: mine.id, owner: `new-${unique}`, type: `changed-${unique}` } as any)
      expect(updated).toMatchObject({ id: mine.id, owner: `new-${unique}`, type: `changed-${unique}`, name: `owned-${unique}` })
      expect(await owned(user.userName!)).toEqual([])
      expect(await owned(`new-${unique}`)).toEqual([`owned-${unique}`])
    },
  },
  {
    // Verified against a real tenant (2026-11): nested fragments are replaced, not merged.
    name: 'inventory: update replaces a fragment as a whole and keeps the others',
    async run({ client, unique }) {
      const { data: created } = await client.inventory.create({ name: `put-${unique}`, c8y_A: { x: 1, y: 2 }, list: [1, 2], keep: 1 } as any)
      await new Promise((resolve) => {
        setTimeout(resolve, 20)
      })
      const { data: updated, res } = await client.inventory.update({ id: created.id, c8y_A: { x: 5 }, list: [3] } as any)
      expect(res.status).toBe(200)
      expect(updated.c8y_A).toEqual({ x: 5 })
      expect(updated.list).toEqual([3])
      expect(updated.keep).toBe(1)
      expect(updated.creationTime).toBe(created.creationTime)
      expect(Date.parse(updated.lastUpdated)).toBeGreaterThan(Date.parse(created.lastUpdated))
      expect((await client.inventory.detail(created.id)).data.c8y_A).toEqual({ x: 5 })

      // an empty object keeps the fragment, null removes it
      const { data: emptied } = await client.inventory.update({ id: created.id, c8y_A: {}, keep: null } as any)
      expect(emptied.c8y_A).toEqual({})
      expect(emptied).not.toHaveProperty('keep')
    },
  },
  {
    // Verified against a real tenant (2026-11).
    name: 'inventory: unknown ids answer 404',
    async run({ client, unique }) {
      const { data: parent } = await client.inventory.create({ name: `known-${unique}` })
      const notFound = async (promise: Promise<unknown>) => {
        const error = await rejection(promise)
        expect(error.res.status).toBe(404)
        expect(error.data?.error).toBe('inventory/Not Found')
        return error
      }

      expect((await notFound(client.inventory.detail(UNKNOWN_ID))).data).toMatchObject({ message: expect.stringContaining(`No managedObject for id '${UNKNOWN_ID}'`) })
      await notFound(client.inventory.update({ id: UNKNOWN_ID, name: 'x' } as any))
      await notFound(client.inventory.delete(UNKNOWN_ID))
      await notFound(client.inventory.childDevicesList(UNKNOWN_ID))
      await notFound(client.inventory.childAssetsList(UNKNOWN_ID))
      await notFound(client.inventory.childAdditionsList(UNKNOWN_ID))
      // unknown parent
      await notFound(client.inventory.childDevicesAdd(parent.id, UNKNOWN_ID))
      await notFound(client.inventory.childAssetsAdd(UNKNOWN_ID, UNKNOWN_ID))
      await notFound(client.inventory.childAdditionsRemove(parent.id, UNKNOWN_ID))
      await notFound(client.inventory.childDevicesCreate({ name: `child-${unique}` } as any, UNKNOWN_ID))
      // unknown child
      await notFound(client.inventory.childAssetsAdd(UNKNOWN_ID, parent.id))
      await notFound(client.inventory.childAdditionsAdd(UNKNOWN_ID, parent.id))
      expect((await client.inventory.childDevicesList(parent.id)).data).toEqual([])
    },
  },
  {
    // Verified against a real tenant (2026-11): removing a non-child fails with 422.
    name: 'inventory: remove children by id (devices, assets, additions)',
    async run({ client, unique }) {
      const { data: parent } = await client.inventory.create({ name: `parent-${unique}` })
      const { data: device } = await client.inventory.create({ name: `device-${unique}`, c8y_IsDevice: {} } as any)
      const { data: asset } = await client.inventory.create({ name: `asset-${unique}` })
      const { data: addition } = await client.inventory.create({ name: `addition-${unique}` })
      expect((await client.inventory.childDevicesAdd(device.id, parent.id)).res.status).toBe(201)
      expect((await client.inventory.childAssetsAdd(asset.id, parent.id)).res.status).toBe(201)
      expect((await client.inventory.childAdditionsAdd(addition.id, parent.id)).res.status).toBe(201)
      // adding the same child again is accepted and does not duplicate it
      expect((await client.inventory.childDevicesAdd(device.id, parent.id)).res.status).toBe(201)
      expect((await client.inventory.childDevicesList(parent.id)).data.map((mo) => mo.id)).toEqual([device.id])

      // a child of another kind is not a child of this kind
      for (const wrong of [
        () => client.inventory.childAssetsRemove(device.id, parent.id),
        () => client.inventory.childAdditionsRemove(asset.id, parent.id),
        () => client.inventory.childDevicesRemove(parent.id, parent.id),
        () => client.inventory.childDevicesRemove(UNKNOWN_ID, parent.id),
      ]) {
        const error = await rejection(wrong())
        expect(error.res.status).toBe(422)
        expect(error.data?.error).toBe('inventory/Invalid Data')
        expect(error.data).toMatchObject({ message: expect.stringContaining('is not a child of object') })
      }

      const removed = await client.inventory.childDevicesRemove(device.id, parent.id)
      expect(removed.res.status).toBe(204)
      expect((await client.inventory.childAssetsRemove(asset.id, parent.id)).res.status).toBe(204)
      expect((await client.inventory.childAdditionsRemove(addition.id, parent.id)).res.status).toBe(204)
      // removing twice fails, the child itself stays
      expect((await rejection(client.inventory.childDevicesRemove(device.id, parent.id))).res.status).toBe(422)
      for (const id of [device.id, asset.id, addition.id]) {
        expect((await client.inventory.detail(id)).res.status).toBe(200)
      }
      const detail = await getJson(client, `/inventory/managedObjects/${parent.id}`)
      for (const kind of ['childDevices', 'childAssets', 'childAdditions']) {
        expect(detail[kind].references).toEqual([])
      }
    },
  },
  {
    // Verified against a real tenant (2026-11).
    name: 'inventory: deleting a parent keeps its children and drops their parent references',
    async run({ client, unique }) {
      const { data: parent } = await client.inventory.create({ name: `parent-${unique}` })
      const { data: child } = await client.inventory.create({ name: `child-${unique}` })
      await client.inventory.childAssetsAdd(child.id, parent.id)
      const withParents = async () => (await getJson(client, `/inventory/managedObjects/${child.id}?withParents=true`)).assetParents.references
      expect(await withParents()).toHaveLength(1)

      await client.inventory.delete(parent.id)
      expect((await client.inventory.detail(child.id)).res.status).toBe(200)
      await eventually(async () => {
        expect(await withParents()).toEqual([])
      })
    },
  },
  {
    // Verified against a real tenant (2026-11).
    name: 'inventory: child lists (paging, totals, query, withChildren)',
    verifies: ['paging-total-pages-zero', 'paging-next-past-end', 'with-children-false-empty-references'],
    async run({ client, unique }) {
      const { data: parent } = await client.inventory.create({ name: `parent-${unique}` })
      for (const name of ['d1', 'd2', 'd3']) {
        const { data: child } = await client.inventory.create({ name: `${name}-${unique}`, type: `cl-${unique}`, c8y_IsDevice: {} } as any)
        await client.inventory.childDevicesAdd(child.id, parent.id)
      }
      const { data: grandchild } = await client.inventory.create({ name: `grandchild-${unique}` })
      const first = (await client.inventory.childDevicesList(parent.id, { query: '$orderby=name asc' })).data[0]!
      expect(first.name).toBe(`d1-${unique}`)
      await client.inventory.childAssetsAdd(grandchild.id, first.id)
      const path = `/inventory/managedObjects/${parent.id}/childDevices`
      const order = '$orderby=name asc'
      const names = (page: Json) => page.references.map((reference: Json) => reference.managedObject.name)

      // statistics only when requested
      const plain = await getJson(client, `${path}?${query({ query: order })}`)
      expect(names(plain)).toEqual([`d1-${unique}`, `d2-${unique}`, `d3-${unique}`])
      expect(plain.statistics).toEqual({ currentPage: 1, pageSize: 5 })
      const totals = await getJson(client, `${path}?${query({ query: order, pageSize: 2, withTotalElements: true, withTotalPages: true })}`)
      expect(names(totals)).toEqual([`d1-${unique}`, `d2-${unique}`])
      expect(totals.statistics).toEqual({ currentPage: 1, pageSize: 2, totalElements: 3, totalPages: 2 })
      expect(totals.next).toEqual(expect.any(String))
      expect(totals.prev).toBeUndefined()

      // last page and past the end: with totals there is no next link
      const last = await getJson(client, `${path}?${query({ query: order, pageSize: 2, currentPage: 2, withTotalPages: true })}`)
      expect(names(last)).toEqual([`d3-${unique}`])
      expect(last.next).toBeUndefined()
      expect(last.prev).toEqual(expect.any(String))
      const past = await getJson(client, `${path}?${query({ query: order, pageSize: 2, currentPage: 3, withTotalPages: true })}`)
      expect(past.references).toEqual([])
      expect(past.statistics).toMatchObject({ currentPage: 3, totalPages: 2 })
      expect(past.next).toBeUndefined()

      // each reference carries the full child; withChildren=false drops the child's own references
      expect(plain.references[0].self).toBe(`${plain.self.split('?')[0]}/${first.id}`)
      expect(plain.references[0].managedObject).toMatchObject({ id: first.id, name: `d1-${unique}`, type: `cl-${unique}` })
      expect(plain.references[0].managedObject.childAssets.references.map((reference: Json) => reference.managedObject.id)).toEqual([grandchild.id])
      const without = await getJson(client, `${path}?${query({ query: order, withChildren: false })}`)
      expect(without.references[0].managedObject.childAssets.references).toEqual([])
      expect(names(without)).toEqual([`d1-${unique}`, `d2-${unique}`, `d3-${unique}`])

      // query filters and orders the children
      const filtered = await getJson(client, `${path}?${query({ query: `$filter=(name eq 'd2*') $orderby=name desc` })}`)
      expect(names(filtered)).toEqual([`d2-${unique}`])
      const desc = await getJson(client, `${path}?${query({ query: '$orderby=name desc' })}`)
      expect(names(desc)).toEqual([`d3-${unique}`, `d2-${unique}`, `d1-${unique}`])
      expect((await getJson(client, `${path}?${query({ query: `$filter=(name eq 'nothing')` })}`)).references).toEqual([])
      const invalid = await rejection(client.inventory.childDevicesList(parent.id, { query: `$filter=(name ne 'x')` }))
      expect(invalid.res.status).toBe(422)

      // the same parameters on the asset and addition lists
      for (const kind of ['childAssets', 'childAdditions']) {
        const list = await getJson(client, `/inventory/managedObjects/${parent.id}/${kind}?${query({ pageSize: 1, withTotalElements: true, withTotalPages: true })}`)
        expect(list.references).toEqual([])
        expect(list.statistics).toEqual({ currentPage: 1, pageSize: 1, totalElements: 0, totalPages: 0 })
      }
    },
  },
  {
    // Verified against a real tenant (2026-11).
    name: 'inventory: single object detail (withChildren, skipChildrenNames, withParents)',
    verifies: ['with-children-false-empty-references', 'parents-only-with-parameter'],
    async run({ client, unique }) {
      const { data: parent } = await client.inventory.create({ name: `parent-${unique}`, type: `pt-${unique}` })
      const { data: child } = await client.inventory.create({ name: `child-${unique}`, type: `ct-${unique}` })
      await client.inventory.childAssetsAdd(child.id, parent.id)
      const base = `/inventory/managedObjects/${parent.id}`

      const detail = await getJson(client, base)
      expect(detail.childAssets.self).toBe(`${detail.self}/childAssets`)
      expect(detail.childAssets.references).toHaveLength(1)
      expect(detail.childAssets.references[0].self).toBe(`${detail.self}/childAssets/${child.id}`)
      // references carry id, self, and name only
      expect(Object.keys(detail.childAssets.references[0].managedObject).sort()).toEqual(['id', 'name', 'self'])
      expect(detail.childAssets.references[0].managedObject.name).toBe(`child-${unique}`)

      const nameless = await getJson(client, `${base}?skipChildrenNames=true`)
      expect(Object.keys(nameless.childAssets.references[0].managedObject).sort()).toEqual(['id', 'self'])

      const childless = await getJson(client, `${base}?withChildren=false`)
      expect(childless.childAssets.references).toEqual([])
      expect(childless.childDevices.references).toEqual([])
      expect(childless).toMatchObject({ id: parent.id, name: `parent-${unique}` })
      expect((await getJson(client, `${base}?withChildren=true`)).childAssets.references).toHaveLength(1)

      // parent references: the child shows its asset parent only with withParents=true
      const childPath = `/inventory/managedObjects/${child.id}`
      expect((await getJson(client, childPath)).assetParents.references).toEqual([])
      const withParents = await getJson(client, `${childPath}?withParents=true`)
      expect(withParents.assetParents.references).toHaveLength(1)
      expect(withParents.assetParents.references[0].managedObject).toMatchObject({ id: parent.id, name: `parent-${unique}`, type: `pt-${unique}` })
      expect(withParents.assetParents.references[0].self).toBeUndefined()
      expect(withParents.deviceParents.references).toEqual([])
      expect(withParents.additionParents.references).toEqual([])
      // withChildren=false affects the child references only
      const both = await getJson(client, `${childPath}?withParents=true&withChildren=false`)
      expect(both.assetParents.references).toHaveLength(1)
    },
  },
  {
    // Verified against a real tenant (2026-11).
    name: 'inventory: list filters (child ids, fragmentType, ids, q, withChildren, skipChildrenNames, withParents)',
    async run({ client, unique }) {
      const { data: parent } = await client.inventory.create({ name: `parent-${unique}`, type: `lf-${unique}` })
      const { data: device } = await client.inventory.create({ name: `device-${unique}`, type: `lf-${unique}`, c8y_IsDevice: {}, c8y_Special: {} } as any)
      const { data: asset } = await client.inventory.create({ name: `asset-${unique}`, type: `lf-${unique}`, c8y_Special: {} } as any)
      const { data: addition } = await client.inventory.create({ name: `addition-${unique}`, type: `lf-${unique}` })
      await client.inventory.childDevicesAdd(device.id, parent.id)
      await client.inventory.childAssetsAdd(asset.id, parent.id)
      await client.inventory.childAdditionsAdd(addition.id, parent.id)
      const list = async (params: Record<string, string | number | boolean>) => (await getJson(client, `/inventory/managedObjects?${query({ pageSize: 100, ...params })}`)).managedObjects as Json[]
      const names = async (params: Record<string, string | number | boolean>) => (await list(params)).map((mo) => mo.name).sort()

      // child ids return the parents
      await eventually(async () => {
        expect(await names({ childDeviceId: device.id })).toEqual([`parent-${unique}`])
        expect(await names({ childAssetId: asset.id })).toEqual([`parent-${unique}`])
        expect(await names({ childAdditionId: addition.id })).toEqual([`parent-${unique}`])
      })
      // a child of another kind does not match
      expect(await names({ childAssetId: device.id })).toEqual([])
      expect(await names({ childDeviceId: UNKNOWN_ID })).toEqual([])

      expect(await names({ fragmentType: 'c8y_Special', text: unique })).toEqual([`asset-${unique}`, `device-${unique}`])
      expect(await names({ fragmentType: 'c8y_IsDevice', text: unique })).toEqual([`device-${unique}`])
      expect(await names({ fragmentType: `c8y_Missing${unique}` })).toEqual([])
      expect(await names({ ids: `${device.id},${asset.id},${UNKNOWN_ID}` })).toEqual([`asset-${unique}`, `device-${unique}`])
      expect(await names({ ids: UNKNOWN_ID })).toEqual([])
      // filters combine with and
      expect(await names({ type: `lf-${unique}`, fragmentType: 'c8y_Special' })).toEqual([`asset-${unique}`, `device-${unique}`])
      expect(await names({ type: `lf-${unique}`, fragmentType: 'c8y_Special', ids: asset.id })).toEqual([`asset-${unique}`])

      // q is the device query: only devices, type is ignored
      expect(await names({ q: `$filter=(name eq '*${unique}')` })).toEqual([`device-${unique}`])
      expect(await names({ q: `$filter=(type eq 'lf-${unique}')`, type: 'ignored' })).toEqual([`device-${unique}`])
      expect((await rejection(client.inventory.list({ q: `$filter=(name ne 'x')` } as any))).res.status).toBe(422)

      // child references: names, withChildren, skipChildrenNames on lists
      const [listed] = await list({ ids: parent.id })
      expect(listed!.childAssets.references.map((reference: Json) => reference.managedObject)).toEqual([expect.objectContaining({ id: asset.id, name: `asset-${unique}` })])
      const [nameless] = await list({ ids: parent.id, skipChildrenNames: true })
      expect(Object.keys(nameless!.childAssets.references[0].managedObject).sort()).toEqual(['id', 'self'])
      const [childless] = await list({ ids: parent.id, withChildren: false })
      expect(childless!.childAssets.references).toEqual([])
      expect(childless!.childDevices.references).toEqual([])
      const [parented] = await list({ ids: asset.id, withParents: true })
      expect(parented!.assetParents.references.map((reference: Json) => reference.managedObject.id)).toEqual([parent.id])
      const [unparented] = await list({ ids: asset.id })
      expect(unparented!.assetParents.references).toEqual([])
    },
  },
  {
    // Verified against a real tenant (2026-11).
    name: 'inventory: paging statistics, next and prev links, invalid page sizes',
    verifies: ['paging-next-past-end', 'paging-page-size-422'],
    async run({ client, unique }) {
      for (const name of ['a', 'b', 'c', 'd', 'e']) {
        await client.inventory.create({ name: `${name}-${unique}`, type: `pg-${unique}` })
      }
      const order = `$filter=(type eq 'pg-${unique}') $orderby=name asc`
      const page = async (params: Record<string, string | number | boolean>) => getJson(client, `/inventory/managedObjects?${query({ query: order, ...params })}`)
      const names = (result: Json) => result.managedObjects.map((mo: Json) => mo.name)

      // default page size 5, no totals unless requested
      const defaults = await page({})
      expect(defaults.statistics).toEqual({ currentPage: 1, pageSize: 5 })
      expect(names(defaults)).toHaveLength(5)
      expect(defaults.self).toEqual(expect.any(String))
      expect((await page({ withTotalElements: true })).statistics).toEqual({ currentPage: 1, pageSize: 5, totalElements: 5 })
      expect((await page({ withTotalPages: true })).statistics).toEqual({ currentPage: 1, pageSize: 5, totalPages: 1 })
      expect((await page({ withTotalPages: false, withTotalElements: false })).statistics).toEqual({ currentPage: 1, pageSize: 5 })

      const middle = await page({ pageSize: 2, currentPage: 2, withTotalElements: true, withTotalPages: true })
      expect(names(middle)).toEqual([`c-${unique}`, `d-${unique}`])
      expect(middle.statistics).toEqual({ currentPage: 2, pageSize: 2, totalElements: 5, totalPages: 3 })
      expect(middle.next).toContain('currentPage=3')
      expect(middle.prev).toContain('currentPage=1')

      // with totals there is no next link on the last page and beyond
      const last = await page({ pageSize: 2, currentPage: 3, withTotalPages: true })
      expect(names(last)).toEqual([`e-${unique}`])
      expect(last.next).toBeUndefined()
      expect(last.prev).toEqual(expect.any(String))
      const beyond = await page({ pageSize: 2, currentPage: 4, withTotalPages: true })
      expect(names(beyond)).toEqual([])
      expect(beyond.next).toBeUndefined()
      // without totals the platform links the next page everywhere
      expect((await page({ pageSize: 2, currentPage: 3 })).next).toEqual(expect.any(String))

      // a page size of 0 means 1, the maximum is 2000, a current page of 0 means 1
      const zero = await page({ pageSize: 0, withTotalPages: true })
      expect(zero.statistics).toMatchObject({ pageSize: 1, totalPages: 5 })
      expect(names(zero)).toEqual([`a-${unique}`])
      expect((await page({ pageSize: 5000 })).statistics).toMatchObject({ pageSize: 2000 })
      expect((await page({ pageSize: 2, currentPage: 0 })).statistics).toMatchObject({ currentPage: 1 })

      const invalid = await client.core.fetch(`/inventory/managedObjects?${query({ pageSize: 'abc' })}`)
      expect(invalid.status).toBe(422)
      expect(await invalid.json()).toMatchObject({ message: 'Parameter \'pageSize\' must have an integer value!' })
    },
  },
  {
    // Verified against a real tenant (2026-11): numbers and strings are distinct types.
    name: 'inventory: query language comparisons (numbers, decimals, strings, booleans, null, quotes)',
    verifies: ['query-typed-values', 'query-upper-case-operators'],
    async run({ client, unique }) {
      const type = `qc-${unique}`
      await client.inventory.create({ name: `a-${unique}`, type, num: 5, s: 'b', dec: 2.5, flag: true } as any)
      await client.inventory.create({ name: `b-${unique}`, type, num: 10, s: 'a', nul: null, str: '5' } as any)
      await client.inventory.create({ name: `c-${unique}`, type, num: 7, s: 'C', flag: false } as any)
      await client.inventory.create({ name: `it's-${unique}`, type } as any)
      await client.inventory.create({ name: `d-${unique}`, type, str: '05', num: 'seven' } as any)
      const names = async (expression: string) =>
        (await client.inventory.list({ query: `$filter=(type eq '${type}' and ${expression})`, pageSize: 100 })).data.map((mo) => mo.name!.replace(`-${unique}`, '')).sort()

      // integers compare as numbers, with or without a d suffix; 05 is the number 5
      expect(await names('num eq 5')).toEqual(['a'])
      expect(await names('num eq 5d')).toEqual(['a'])
      expect(await names('num eq 5.0d')).toEqual(['a'])
      expect(await names('num eq 05')).toEqual(['a'])
      // a decimal without suffix and a quoted number are strings: they never match a number
      expect(await names('num eq 5.0')).toEqual([])
      expect(await names('num eq \'5\'')).toEqual([])
      // and a number never matches a string property
      expect(await names('str eq 5')).toEqual([])
      expect(await names('str eq \'5\'')).toEqual(['b'])
      expect(await names('str eq \'05\'')).toEqual(['d'])
      expect(await names('num gt 5')).toEqual(['b', 'c'])
      expect(await names('num ge 7')).toEqual(['b', 'c'])
      expect(await names('num lt 10')).toEqual(['a', 'c'])
      expect(await names('num le 7')).toEqual(['a', 'c'])
      expect(await names('num gt 6.5d')).toEqual(['b', 'c'])
      expect(await names('dec eq 2.5d')).toEqual(['a'])
      expect(await names('dec gt 2d')).toEqual(['a'])
      expect(await names('num gt \'a\'')).toEqual(['d'])
      expect(await names('s gt 5')).toEqual([])

      // strings compare by character code: uppercase sorts before lowercase
      expect(await names('s gt \'a\'')).toEqual(['a'])
      expect(await names('s ge \'b\'')).toEqual(['a'])
      expect(await names('s lt \'b\'')).toEqual(['b', 'c'])
      expect(await names('s le \'a\'')).toEqual(['b', 'c'])
      expect(await names('s gt \'B\'')).toEqual(['a', 'b', 'c'])
      expect(await names('s lt \'c\'')).toEqual(['a', 'b', 'c'])
      expect(await names(`name gt 'b-${unique}'`)).toEqual(['c', 'd', 'it\'s'])

      // booleans are literals, not strings
      expect(await names('flag eq true')).toEqual(['a'])
      expect(await names('flag eq \'true\'')).toEqual([])
      expect(await names('flag eq false')).toEqual(['c'])

      // null matches a stored null only, never a missing property
      expect(await names('nul eq null')).toEqual(['b'])
      expect(await names('has(nul)')).toEqual(['b'])
      expect(await names('missing eq null')).toEqual([])
      expect(await names('s eq null')).toEqual([])

      // a quote in a value is doubled; wildcards work at either end
      expect(await names(`name eq 'it''s-${unique}'`)).toEqual(['it\'s'])
      expect(await names('name eq \'it\'\'s*\'')).toEqual(['it\'s'])
      expect(await names(`name eq '*s-${unique}'`)).toEqual(['it\'s'])

      // and binds tighter than or, not() includes objects without the property
      expect(await names('num eq 5 or num eq 10')).toEqual(['a', 'b'])
      expect(await names(`name eq 'nothing' and num eq 5 or num eq 10`)).toEqual(['b'])
      expect(await names('not(num eq 5)')).toEqual(['b', 'c', 'd', 'it\'s'])

      // syntax: $filter and parentheses are optional, operators are lowercase
      const plain = (await client.inventory.list({ query: `type eq '${type}' and num eq 5` })).data
      expect(plain.map((mo) => mo.name)).toEqual([`a-${unique}`])
      const noPrefix = (await client.inventory.list({ query: `$filter=type eq '${type}' and num eq 5` })).data
      expect(noPrefix.map((mo) => mo.name)).toEqual([`a-${unique}`])
      for (const invalid of [`$filter=(type EQ '${type}')`, `$filter=(type eq`, `$filter=(type like 'x')`]) {
        expect((await rejection(client.inventory.list({ query: invalid }))).res.status).toBe(422)
      }
    },
  },
  {
    // Verified against a real tenant (2026-11).
    name: 'inventory: $orderby (nested, numbers before strings, missing values, no filter)',
    verifies: ['orderby-type-order'],
    async run({ client, unique }) {
      const type = `ob-${unique}`
      await client.inventory.create({ name: `a-${unique}`, type, num: 5, s: 'b', nested: { v: 2 }, mixed: 1 })
      await client.inventory.create({ name: `b-${unique}`, type, num: 10, s: 'a', nested: { v: 10 }, mixed: 'x' })
      await client.inventory.create({ name: `c-${unique}`, type, num: 7, s: 'C', nested: { v: 1 }, mixed: true })
      await client.inventory.create({ name: `d-${unique}`, type, num: 'seven', mixed: false })
      await client.inventory.create({ name: `e-${unique}`, type } as any)
      const names = async (expression: string, extra: Record<string, unknown> = {}) =>
        (await client.inventory.list({ query: expression, pageSize: 100, ...extra } as any)).data.map((mo) => mo.name!.replace(`-${unique}`, ''))
      const filter = `$filter=(type eq '${type}'`

      // numbers sort numerically, nested paths work
      expect(await names(`${filter} and has(nested)) $orderby=nested.v asc`)).toEqual(['c', 'a', 'b'])
      expect(await names(`${filter} and has(nested)) $orderby=nested.v desc`)).toEqual(['b', 'a', 'c'])
      // numbers sort before strings
      expect(await names(`${filter} and has(num)) $orderby=num asc`)).toEqual(['a', 'c', 'b', 'd'])
      expect(await names(`${filter} and has(num)) $orderby=num desc`)).toEqual(['d', 'b', 'c', 'a'])
      // booleans sort after strings, false before true
      expect(await names(`${filter} and has(mixed)) $orderby=mixed asc`)).toEqual(['a', 'b', 'd', 'c'])
      expect(await names(`${filter} and has(mixed)) $orderby=mixed desc`)).toEqual(['c', 'd', 'b', 'a'])
      // strings by character code: uppercase first
      expect(await names(`${filter} and has(s)) $orderby=s asc`)).toEqual(['c', 'b', 'a'])
      expect(await names(`${filter} and has(s)) $orderby=s desc`)).toEqual(['a', 'b', 'c'])
      // objects without the property come first ascending and last descending
      const ascending = await names(`${filter}) $orderby=s asc`)
      expect(ascending.slice(0, 2).sort()).toEqual(['d', 'e'])
      expect(ascending.slice(2)).toEqual(['c', 'b', 'a'])
      const descending = await names(`${filter}) $orderby=s desc`)
      expect(descending.slice(0, 3)).toEqual(['a', 'b', 'c'])
      expect(descending.slice(3).sort()).toEqual(['d', 'e'])
      // the direction defaults to ascending; several fields apply in order
      expect(await names(`${filter}) $orderby=name`)).toEqual(['a', 'b', 'c', 'd', 'e'])
      expect(await names(`${filter} and has(s)) $orderby=num desc, name asc`)).toEqual(['b', 'c', 'a'])
      // $orderby alone works without a filter
      expect(await names('$orderby=name desc', { text: unique })).toEqual(['e', 'd', 'c', 'b', 'a'])
    },
  },
]

export const inventoryConformanceScenarios: ContractScenario[] = [
  {
    name: 'inventory: query language on standard properties, literal left side, invalid paths and arguments',
    verifies: ['query-has-standard-property', 'query-literal-left-side', 'query-invalid-path', 'query-function-arguments', 'query-upper-case-operators', 'query-date-literals'],
    async run({ client, unique }) {
      const type = `qs-${unique}`
      await client.inventory.create({ name: `x-${unique}`, type, c8y_Flag: {} })
      await client.inventory.create({ name: `y-${unique}`, type })
      const names = async (expression: string) =>
        (await client.inventory.list({ query: `$filter=(type eq '${type}' and ${expression})`, pageSize: 100 })).data.map((mo) => mo.name!.replace(`-${unique}`, '')).sort()

      // has() and hasany() on standard properties match nothing
      for (const property of ['id', 'self', 'name', 'type', 'owner', 'creationTime', 'lastUpdated', 'childDevices', 'childAssets', 'childAdditions', 'deviceParents', 'assetParents', 'additionParents']) {
        expect(await names(`has(${property})`), property).toEqual([])
      }
      expect(await names('hasany(name,type)')).toEqual([])
      expect(await names('has(c8y_Flag)')).toEqual(['x'])
      expect(await names('hasany(name,c8y_Flag)')).toEqual(['x'])

      // a quoted left side is accepted and names the property
      expect(await names(`'a' eq 'a'`)).toEqual([])
      expect(await names(`'name' eq 'x-${unique}'`)).toEqual(['x'])
      // function arguments are not validated: unknown group ids match nothing, quoted fragments work
      expect(await names(`bygroupid(abc)`)).toEqual([])
      expect(await names(`bygroupid(eq, 'x')`)).toEqual([])
      expect(await names(`isinhierarchyof('${UNKNOWN_ID}')`)).toEqual([])
      expect(await names(`has('c8y_Flag')`)).toEqual(['x'])
      // a .date literal needs a date and a time; seconds, fraction, and zone are optional, fields may have one digit
      for (const literal of ['2020-01-01T00:00', '2020-1-1T0:0:0Z', '2020-01-01T00:00:00.1234567Z', '2020-01-01T00:00:00+0100']) {
        expect(await names(`creationTime.date gt '${literal}'`), literal).toEqual(['x', 'y'])
      }
      // anything else matches nothing (no error)
      for (const literal of ['2020-01-01', '2020-1-1', 'yesterday', '2020-01-01 00:00:00', '2020-01-01T00Z']) {
        expect(await names(`creationTime.date gt '${literal}'`), literal).toEqual([])
      }

      // lower-case t/z is not a date-time, a quoted fragment with a slash is accepted
      expect(await names(`creationTime.date gt '2020-01-01t09:00z'`)).toEqual([])
      expect(await names(`has('a/b')`)).toEqual([])
      // rejected: paths with / or [], upper-case operators, impossible dates, quoted operators, bad argument lists
      const statuses: Record<string, number> = {}
      const invalids = [
        `groups/id eq 'x'`,
        `externalIds["serialNumber"].id eq 'x'`,
        `name eq 'x' AND type eq '${type}'`,
        `name eq 'x' OR type eq '${type}'`,
        `NOT(name eq 'x')`,
        `creationTime.date gt '2020-13-01T00:00:00Z'`,
        `creationTime.date gt '2020-01-01T25:00:00Z'`,
        `creationTime.date gt '2020-01-01T09:00:00.1234567891Z'`,
        `name 'eq' 'x'`,
        `hasany(c8y_Flag missing)`,
        `has(c8y_Flag,)`,
      ]
      for (const invalid of invalids) {
        statuses[invalid] = (await client.core.fetch(`/inventory/managedObjects?${query({ query: `$filter=(type eq '${type}' and ${invalid})` })}`)).status
      }
      expect(statuses).toEqual(Object.fromEntries(invalids.map((invalid) => [invalid, 422])))
    },
  },
  {
    name: 'inventory: $orderby on arrays and byte-wise string order',
    verifies: ['orderby-arrays', 'orderby-byte-wise'],
    async run({ client, unique }) {
      const type = `oa-${unique}`
      await client.inventory.create({ name: `AH-VW-10-${unique}`, type, tags: [5, 1] })
      await client.inventory.create({ name: `AH-VW-100-${unique}`, type, tags: [3] })
      await client.inventory.create({ name: `AH-VW-14-${unique}`, type, tags: [2, 9] })
      await client.inventory.create({ name: `ah-vw-1-${unique}`, type, tags: ['b', 'a'] })
      const names = async (orderBy: string) =>
        (await client.inventory.list({ query: `$filter=(type eq '${type}') $orderby=${orderBy}`, pageSize: 100 })).data.map((mo) => mo.name!.replace(`-${unique}`, ''))

      // strings byte-wise: upper case first, "10" < "100" < "14"
      expect(await names('name asc')).toEqual(['AH-VW-10', 'AH-VW-100', 'AH-VW-14', 'ah-vw-1'])
      expect(await names('name desc')).toEqual(['ah-vw-1', 'AH-VW-14', 'AH-VW-100', 'AH-VW-10'])
      // arrays by their smallest element ascending and their largest descending
      expect(await names('tags asc')).toEqual(['AH-VW-10', 'AH-VW-14', 'AH-VW-100', 'ah-vw-1'])
      expect(await names('tags desc')).toEqual(['ah-vw-1', 'AH-VW-14', 'AH-VW-10', 'AH-VW-100'])
    },
  },
]
