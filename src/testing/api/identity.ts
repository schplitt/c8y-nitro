import type { C8yRequest } from '../types'
import type { ExternalId, TenantData } from '../store'
import { apiError, baseUrl, checkQuery, paged } from './http'
import { moSelf, notFound } from './inventory'

function renderExternalId(entry: ExternalId) {
  return {
    externalId: entry.externalId,
    type: entry.type,
    self: `${baseUrl()}/identity/externalIds/${encodeURIComponent(entry.type)}/${encodeURIComponent(entry.externalId)}`,
    managedObject: { id: entry.managedObjectId, self: moSelf(entry.managedObjectId) },
  }
}

/**
 * Adds an external id. Fails like the platform on unknown objects or duplicates.
 * @param data - Tenant data
 * @param managedObjectId - Managed object id
 * @param type - External id type, e.g. `c8y_Serial`
 * @param externalId - External id value
 */
export function addExternalId(data: TenantData, managedObjectId: string, type: string, externalId: string): Response | ExternalId {
  if (!data.managedObjects.has(managedObjectId)) {
    return notFound(managedObjectId)
  }
  const existing = data.externalIds.find((entry) => entry.type === type && entry.externalId === externalId)
  if (existing) {
    // verified against the platform: idempotent for the same object
    return existing.managedObjectId === managedObjectId
      ? existing
      : apiError(409, 'identity/Duplicate', `ID [type=${type}, value=${externalId}] was already bound to different Global ID.`)
  }
  const entry = { type, externalId, managedObjectId }
  data.externalIds.push(entry)
  return entry
}

/**
 * Identity API: external ids.
 * @param call - The request
 * @param segments - Path segments
 * @param data - Tenant data
 */
export function identity(call: C8yRequest, segments: string[], data: TenantData): Response | undefined {
  const [, resource, a, b] = segments
  const { method } = call

  if (resource === 'externalIds' && a !== undefined && b !== undefined && segments.length === 4) {
    const index = data.externalIds.findIndex((entry) => entry.type === a && entry.externalId === b)
    if (method === 'GET') {
      checkQuery('GET /identity/externalIds/{type}/{externalId}', call, [])
      return index === -1
        ? apiError(404, 'identity/Not Found', `External id not found; external id = ID [type=${a}, value=${b}]`)
        : Response.json(renderExternalId(data.externalIds[index]!))
    }
    if (method === 'DELETE') {
      checkQuery('DELETE /identity/externalIds/{type}/{externalId}', call, [])
      if (index === -1) {
        return apiError(404, 'identity/Not Found', `External id not found; external id = ID [type=${a}, value=${b}]`)
      }
      data.externalIds.splice(index, 1)
      return new Response(null, { status: 204 })
    }
    return undefined
  }

  if (resource === 'globalIds' && a !== undefined && b === 'externalIds' && segments.length === 4) {
    if (method === 'GET') {
      checkQuery('GET /identity/globalIds/{id}/externalIds', call, [])
      if (!data.managedObjects.has(a)) {
        return notFound(a)
      }
      const items = data.externalIds.filter((entry) => entry.managedObjectId === a).map(renderExternalId)
      return paged(call, 'externalIds', items, `/identity/globalIds/${a}/externalIds`)
    }
    if (method === 'POST') {
      checkQuery('POST /identity/globalIds/{id}/externalIds', call, [])
      const body = (call.body ?? {}) as { type?: string, externalId?: string }
      if (!body.type || !body.externalId) {
        return apiError(422, 'undefined/validationError', 'Following mandatory fields should be included: externalId,type')
      }
      const result = addExternalId(data, a, body.type, body.externalId)
      return result instanceof Response ? result : Response.json(renderExternalId(result), { status: 201 })
    }
  }

  return undefined
}
