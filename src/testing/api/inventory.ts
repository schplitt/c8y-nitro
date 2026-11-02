import type { C8yRequest } from '../types'
import type { ChildKind, StoredDocument, TenantData } from '../store'
import { addChild, CHILD_KINDS, childIds, deleteManagedObject, PARENT_KIND, parentIds, removeChild, store } from '../store'
import { apiError, baseUrl, checkQuery, flag, paged } from './http'
import { applyOrderBy, parseQuery, QuerySyntaxError } from './query'
import { notify } from '../notify'

const SERVER_FIELDS = ['id', 'self', 'creationTime', 'lastUpdated', ...CHILD_KINDS, ...Object.values(PARENT_KIND)]

export function moSelf(id: string): string {
  return `${baseUrl()}/inventory/managedObjects/${id}`
}

export function notFound(id: string): Response {
  return apiError(404, 'inventory/Not Found', `Finding device data from database failed : No managedObject for id '${id}'!`)
}

/**
 * Renders a stored managed object like the platform: `self`, child references
 * (`childDevices`, `childAssets`, `childAdditions`), and parent references.
 * @param data - Tenant data
 * @param document - Stored managed object
 * @param options - Rendering options
 * @param options.withChildren - Include child references (default true)
 * @param options.skipChildrenNames - Omit names in references
 */
export function renderManagedObject(data: TenantData, document: StoredDocument, options: { withChildren?: boolean, skipChildrenNames?: boolean } = {}): StoredDocument {
  const self = moSelf(document.id)
  const reference = (id: string, referenceSelf: string) => ({
    self: referenceSelf,
    managedObject: {
      id,
      self: moSelf(id),
      ...(options.skipChildrenNames ? {} : { name: data.managedObjects.get(id)?.name }),
    },
  })
  const rendered: StoredDocument = { ...structuredClone(document), self }
  for (const kind of CHILD_KINDS) {
    const children = options.withChildren === false ? [] : childIds(data, document.id, kind)
    rendered[kind] = { self: `${self}/${kind}`, references: children.map((id) => reference(id, `${self}/${kind}/${id}`)) }
    const parentKind = PARENT_KIND[kind]
    rendered[parentKind] = { self: `${self}/${parentKind}`, references: parentIds(data, document.id, kind).map((id) => reference(id, `${moSelf(id)}/${kind}/${document.id}`)) }
  }
  return rendered
}

/**
 * Creates a managed object (server fields assigned, relation fields ignored).
 * @param data - Tenant data
 * @param body - Managed object fragments
 * @param owner - Owner user name
 */
export function createManagedObject(data: TenantData, body: Record<string, unknown>, owner: string): StoredDocument {
  const now = store.now()
  const document: StoredDocument = { id: store.newId(), owner, ...omit(body, SERVER_FIELDS), creationTime: now, lastUpdated: now }
  if (typeof body.owner === 'string') {
    document.owner = body.owner
  }
  data.managedObjects.set(document.id, document)
  notify(data, 'managedobjects', 'CREATE', renderManagedObject(data, document), document.id)
  return document
}

function omit(body: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([key]) => !fields.includes(key)))
}

function searchText(data: TenantData, document: StoredDocument, text: string): boolean {
  const haystack = [
    document.id,
    document.type,
    document.name,
    document.owner,
    ...data.externalIds.filter((entry) => entry.managedObjectId === document.id).map((entry) => entry.externalId),
  ].filter((value) => typeof value === 'string').join(' ').toLowerCase()
  return text.toLowerCase().split(/\s+/).filter(Boolean).every((token) => haystack.includes(token))
}

function listManagedObjects(call: C8yRequest, data: TenantData, documents: StoredDocument[]): StoredDocument[] {
  let items = documents
  const { query } = call
  // documented platform behavior: `type` is ignored when a query is given
  if (query.type && query.query === undefined && query.q === undefined) {
    items = items.filter((document) => document.type === query.type)
  }
  if (query.fragmentType) {
    items = items.filter((document) => document[query.fragmentType!] !== undefined)
  }
  if (query.ids) {
    const ids = query.ids.split(',')
    items = items.filter((document) => ids.includes(document.id))
  }
  if (query.owner) {
    items = items.filter((document) => document.owner === query.owner)
  }
  if (query.text) {
    items = items.filter((document) => searchText(data, document, query.text!))
  }
  const childFilters: Array<[string, ChildKind]> = [['childDeviceId', 'childDevices'], ['childAssetId', 'childAssets'], ['childAdditionId', 'childAdditions']]
  for (const [param, kind] of childFilters) {
    if (query[param]) {
      items = items.filter((document) => childIds(data, document.id, kind).includes(query[param]!))
    }
  }
  if (flag(call, 'onlyRoots')) {
    items = items.filter((document) => CHILD_KINDS.every((kind) => parentIds(data, document.id, kind).length === 0))
  }
  let orderBy: ReturnType<typeof parseQuery>['orderBy'] = []
  for (const param of ['query', 'q'] as const) {
    if (query[param]) {
      const parsed = parseQuery(query[param]!, data)
      items = items.filter((document) => parsed.filter(document))
      orderBy = parsed.orderBy
    }
  }
  if (query.q !== undefined) {
    // `q` is the device query: devices only
    items = items.filter((document) => document.c8y_IsDevice !== undefined)
  }
  return applyOrderBy(items, orderBy)
}

const LIST_PARAMS = ['childAdditionId', 'childAssetId', 'childDeviceId', 'currentPage', 'fragmentType', 'ids', 'onlyRoots', 'owner', 'pageSize', 'q', 'query', 'skipChildrenNames', 'text', 'type', 'withChildren', 'withParents', 'withTotalElements', 'withTotalPages']
const DETAIL_PARAMS = ['skipChildrenNames', 'withChildren', 'withParents']

/**
 * Inventory API: managed objects and child references.
 * @param call - The request
 * @param segments - Path segments
 * @param data - Tenant data
 */
export function inventory(call: C8yRequest, segments: string[], data: TenantData): Response | undefined {
  try {
    return inventoryRequest(call, segments, data)
  } catch (error) {
    if (error instanceof QuerySyntaxError) {
      const query = call.query.query ?? call.query.q
      return apiError(422, 'inventory/Invalid Data', `Find by filter query failed : Query '${query}' could not be understood. Please try again.`)
    }
    throw error
  }
}

function inventoryRequest(call: C8yRequest, segments: string[], data: TenantData): Response | undefined {
  const [, , id, kind, childId] = segments
  const { method } = call
  const render = (document: StoredDocument) => renderManagedObject(data, document, {
    withChildren: flag(call, 'withChildren', true),
    skipChildrenNames: flag(call, 'skipChildrenNames'),
  })

  if (id === undefined) {
    if (method === 'GET') {
      checkQuery('GET /inventory/managedObjects', call, LIST_PARAMS)
      const items = listManagedObjects(call, data, [...data.managedObjects.values()])
      return paged(call, 'managedObjects', items.map(render), '/inventory/managedObjects')
    }
    if (method === 'POST') {
      checkQuery('POST /inventory/managedObjects', call, [])
      const document = createManagedObject(data, (call.body ?? {}) as Record<string, unknown>, call.user ?? 'test-user')
      return Response.json(render(document), { status: 201 })
    }
    return undefined
  }

  const document = data.managedObjects.get(id)

  if (kind === undefined) {
    if (method === 'GET') {
      checkQuery('GET /inventory/managedObjects/{id}', call, DETAIL_PARAMS)
      return document ? Response.json(render(document)) : notFound(id)
    }
    if (method === 'PUT') {
      checkQuery('PUT /inventory/managedObjects/{id}', call, [])
      if (!document) {
        return notFound(id)
      }
      for (const [key, value] of Object.entries(omit((call.body ?? {}) as Record<string, unknown>, SERVER_FIELDS))) {
        if (value === null) {
          delete document[key]
        } else {
          document[key] = value
        }
      }
      document.lastUpdated = store.now()
      notify(data, 'managedobjects', 'UPDATE', renderManagedObject(data, document), document.id)
      return Response.json(render(document))
    }
    if (method === 'DELETE') {
      checkQuery('DELETE /inventory/managedObjects/{id}', call, [])
      if (!deleteManagedObject(data, id)) {
        return notFound(id)
      }
      notify(data, 'managedobjects', 'DELETE', { id }, id)
      return new Response(null, { status: 204 })
    }
    return undefined
  }

  if (!(CHILD_KINDS as string[]).includes(kind)) {
    return undefined
  }
  const childKind = kind as ChildKind
  const endpoint = `/inventory/managedObjects/{id}/${childKind}` as const

  if (childId === undefined && method === 'GET') {
    checkQuery(`GET ${endpoint}`, call, ['currentPage', 'pageSize', 'query', 'withChildren', 'withTotalElements', 'withTotalPages'])
    if (!document) {
      return notFound(id)
    }
    let children = childIds(data, id, childKind).map((child) => data.managedObjects.get(child)).filter((child) => child !== undefined)
    if (call.query.query) {
      const parsed = parseQuery(call.query.query, data)
      children = applyOrderBy(children.filter((child) => parsed.filter(child)), parsed.orderBy)
    }
    const references = children.map((child) => ({ self: `${moSelf(id)}/${childKind}/${child.id}`, managedObject: render(child) }))
    return paged(call, 'references', references, `/inventory/managedObjects/${id}/${childKind}`)
  }

  if (childId === undefined && method === 'POST') {
    checkQuery(`POST ${endpoint}`, call, [])
    if (!document) {
      return notFound(id)
    }
    const body = (call.body ?? {}) as Record<string, any>
    const contentType = call.headers['content-type'] ?? ''
    // createChild: a new managed object, created and attached
    if (contentType.includes('managedobject+json')) {
      const child = createManagedObject(data, body, call.user ?? 'test-user')
      addChild(data, id, childKind, child.id)
      return Response.json(render(child), { status: 201 })
    }
    const requested: string[] = Array.isArray(body.references)
      ? body.references.map((reference: any) => String(reference.managedObject?.id))
      : [String(body.managedObject?.id)]
    for (const child of requested) {
      if (!data.managedObjects.has(child)) {
        return notFound(child)
      }
    }
    const references = requested.map((child) => {
      addChild(data, id, childKind, child)
      return { self: `${moSelf(id)}/${childKind}/${child}`, managedObject: render(data.managedObjects.get(child)!) }
    })
    return Response.json(Array.isArray(body.references) ? { references } : references[0], { status: 201 })
  }

  if (childId !== undefined && method === 'DELETE') {
    return removeChild(data, id, childKind, childId) ? new Response(null, { status: 204 }) : notFound(childId)
  }

  return undefined
}
