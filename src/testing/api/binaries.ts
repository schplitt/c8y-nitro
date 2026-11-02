import type { C8yRequest } from '../types'
import type { BinaryContent, StoredDocument, TenantData } from '../store'
import { CHILD_KINDS, childIds, deleteManagedObject, store } from '../store'
import { notify } from '../notify'
import { apiError, baseUrl, checkQuery, paged, raw } from './http'
import { createManagedObject, notFound, renderManagedObject } from './inventory'

interface Upload {
  content: BinaryContent
  object: Record<string, unknown>
}

/**
 * Reads an upload: a multipart body with `object` (JSON) and `file` parts, or
 * a raw body (event attachments, binary replacement).
 * @param call - The request
 * @returns The upload, or an error response
 */
async function readUpload(call: C8yRequest): Promise<Upload | Response> {
  const { bytes, contentType } = raw(call)
  if (!contentType.startsWith('multipart/')) {
    return { content: { bytes, contentType: contentType || 'application/octet-stream', name: 'bin' }, object: {} }
  }
  const form = await new Request('http://upload.invalid', { method: 'POST', headers: { 'content-type': contentType }, body: bytes as unknown as Blob }).formData()
  const part = form.get('file')
  if (part === null) {
    return apiError(422, 'binaries/Invalid Data', 'Missing file part')
  }
  // a file part without a filename arrives as a string
  const file = typeof part === 'string' ? new Blob([part]) : part
  let object: Record<string, unknown> = {}
  const objectPart = form.get('object')
  if (typeof objectPart === 'string' && objectPart) {
    try {
      object = JSON.parse(objectPart)
    } catch {
      return apiError(422, 'binaries/Invalid Data', 'The object part is not valid JSON')
    }
  }
  const name = typeof object.name === 'string' ? object.name : (file as File).name || 'bin'
  return {
    content: { bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.type || 'application/octet-stream', name },
    object,
  }
}

function download(content: BinaryContent): Response {
  return new Response(content.bytes as unknown as Blob, { headers: { 'content-type': content.contentType, 'content-length': String(content.bytes.length) } })
}

/**
 * Creates an inventory binary (a managed object with `c8y_IsBinary`).
 * @param data - Tenant data
 * @param content - File content
 * @param object - Managed object fragments from the upload
 * @param owner - Owner user name
 */
export function createBinary(data: TenantData, content: BinaryContent, object: Record<string, unknown>, owner: string): StoredDocument {
  const document = createManagedObject(data, {
    ...object,
    name: object.name ?? content.name,
    type: object.type ?? content.contentType,
    contentType: content.contentType,
    length: content.bytes.length,
    c8y_IsBinary: '',
  }, owner)
  data.binaries.set(document.id, content)
  return document
}

/**
 * Inventory binaries API: `/inventory/binaries[/{id}]`.
 * @param call - The request
 * @param segments - Path segments
 * @param data - Tenant data
 */
export async function inventoryBinaries(call: C8yRequest, segments: string[], data: TenantData): Promise<Response | undefined> {
  const [, , id] = segments
  const { method } = call

  if (id === undefined) {
    if (method === 'POST') {
      checkQuery('POST /inventory/binaries', call, [])
      const upload = await readUpload(call)
      if (upload instanceof Response) {
        return upload
      }
      const document = createBinary(data, upload.content, upload.object, call.user ?? 'test-user')
      return Response.json(renderManagedObject(data, document), { status: 201 })
    }
    if (method === 'GET') {
      const supported = ['childAdditionId', 'childAssetId', 'childDeviceId', 'currentPage', 'ids', 'owner', 'pageSize', 'type', 'withTotalPages']
      checkQuery('GET /inventory/binaries', call, supported)
      const { query } = call
      const ids = query.ids?.split(',')
      const items = [...data.managedObjects.values()].filter((document) => document.c8y_IsBinary !== undefined
        && (ids === undefined || ids.includes(document.id))
        && (query.owner === undefined || document.owner === query.owner)
        && (query.type === undefined || document.type === query.type)
        && CHILD_KINDS.every((kind, index) => {
          const parent = query[['childDeviceId', 'childAssetId', 'childAdditionId'][index]!]
          return parent === undefined || childIds(data, document.id, kind).includes(parent)
        }))
      return paged(call, 'managedObjects', items.map((document) => renderManagedObject(data, document)), '/inventory/binaries')
    }
    return undefined
  }

  const document = data.managedObjects.get(id)
  const content = data.binaries.get(id)
  if (method === 'GET') {
    checkQuery('GET /inventory/binaries/{id}', call, [])
    return content ? download(content) : notFound(id)
  }
  if (method === 'PUT') {
    checkQuery('PUT /inventory/binaries/{id}', call, [])
    if (!document || !content) {
      return notFound(id)
    }
    const upload = await readUpload(call)
    if (upload instanceof Response) {
      return upload
    }
    data.binaries.set(id, { ...upload.content, name: content.name })
    document.contentType = upload.content.contentType
    document.length = upload.content.bytes.length
    document.lastUpdated = store.now()
    const rendered = renderManagedObject(data, document)
    notify(data, 'managedobjects', 'UPDATE', rendered, id)
    return Response.json(rendered, { status: 201 })
  }
  if (method === 'DELETE') {
    checkQuery('DELETE /inventory/binaries/{id}', call, [])
    if (!content || !deleteManagedObject(data, id)) {
      return notFound(id)
    }
    data.binaries.delete(id)
    notify(data, 'managedobjects', 'DELETE', { id }, id)
    return new Response(null, { status: 204 })
  }
  return undefined
}

function renderAttachment(eventId: string, content: BinaryContent) {
  return {
    self: `${baseUrl()}/event/events/${eventId}/binaries`,
    source: eventId,
    name: content.name,
    type: content.contentType,
    length: content.bytes.length,
  }
}

/**
 * Event attachments: `/event/events/{id}/binaries`.
 * @param call - The request
 * @param eventId - Event id
 * @param data - Tenant data
 */
export async function eventBinaries(call: C8yRequest, eventId: string, data: TenantData): Promise<Response | undefined> {
  const { method } = call
  if (!data.events.has(eventId)) {
    return apiError(404, 'event/Not Found', `Finding event from database failed : No event for id '${eventId}'!`)
  }
  const existing = data.eventBinaries.get(eventId)

  if (method === 'POST' || method === 'PUT') {
    checkQuery(`${method} /event/events/{id}/binaries` as 'POST /event/events/{id}/binaries', call, [])
    if (method === 'POST' && existing) {
      return apiError(409, 'event/Conflict', `Event '${eventId}' already has an attachment`)
    }
    const upload = await readUpload(call)
    if (upload instanceof Response) {
      return upload
    }
    const content = { ...upload.content, name: method === 'PUT' && existing ? existing.name : upload.content.name }
    data.eventBinaries.set(eventId, content)
    return Response.json(renderAttachment(eventId, content), { status: 201 })
  }
  if (method === 'GET') {
    checkQuery('GET /event/events/{id}/binaries', call, [])
    return existing ? download(existing) : apiError(404, 'event/Not Found', `Event '${eventId}' has no attachment`)
  }
  if (method === 'DELETE') {
    checkQuery('DELETE /event/events/{id}/binaries', call, [])
    if (!existing) {
      return apiError(404, 'event/Not Found', `Event '${eventId}' has no attachment`)
    }
    data.eventBinaries.delete(eventId)
    return new Response(null, { status: 204 })
  }
  return undefined
}
