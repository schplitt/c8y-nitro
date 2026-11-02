import type { C8yRequest } from '../types'
import type { C8yEndpoint } from '../capabilities.generated'
import type { DocumentCollection, StoredDocument, TenantData } from '../store'
import { C8Y_ENUMS } from '../capabilities.generated'
import { store } from '../store'
import { apiError, baseUrl, byTime, checkQuery, checkRequired, flag, inRange, paged, sourceId } from './http'
import { moSelf } from './inventory'

interface Resource {
  collection: Exclude<DocumentCollection, 'managedObjects'>
  /**
   * URL path of the collection, e.g. `/alarm/alarms`
   */
  path: string
  /**
   * Error code prefix, e.g. `alarm`
   */
  domain: string
  /**
   * Supported list query parameters
   */
  listParams: string[]
}

export type { Resource }

export const RESOURCES = {
  measurement: { collection: 'measurements', path: '/measurement/measurements', domain: 'measurement', listParams: ['currentPage', 'dateFrom', 'dateTo', 'pageSize', 'revert', 'source', 'type', 'valueFragmentSeries', 'valueFragmentType', 'withTotalElements', 'withTotalPages'] },
  event: { collection: 'events', path: '/event/events', domain: 'event', listParams: ['createdFrom', 'createdTo', 'currentPage', 'dateFrom', 'dateTo', 'fragmentType', 'lastUpdatedFrom', 'lastUpdatedTo', 'pageSize', 'revert', 'source', 'type', 'withTotalElements', 'withTotalPages'] },
  alarm: { collection: 'alarms', path: '/alarm/alarms', domain: 'alarm', listParams: ['createdFrom', 'createdTo', 'currentPage', 'dateFrom', 'dateTo', 'lastUpdatedFrom', 'lastUpdatedTo', 'pageSize', 'resolved', 'severity', 'source', 'status', 'type', 'withTotalElements', 'withTotalPages'] },
  devicecontrol: { collection: 'operations', path: '/devicecontrol/operations', domain: 'devicecontrol', listParams: ['currentPage', 'dateFrom', 'dateTo', 'deviceId', 'fragmentType', 'pageSize', 'revert', 'status', 'withTotalElements', 'withTotalPages'] },
} satisfies Record<string, Resource>

const SERVER_FIELDS = ['id', 'self', 'creationTime', 'lastUpdated', 'count', 'firstOccurrenceTime']

export function renderDocument(data: TenantData, resource: Resource, document: StoredDocument): StoredDocument {
  const rendered: StoredDocument = { ...structuredClone(document), self: `${baseUrl()}${resource.path}/${document.id}` }
  const source = sourceId(document)
  if (source !== undefined) {
    rendered.source = { id: source, self: moSelf(source), name: data.managedObjects.get(source)?.name }
  }
  if (resource.collection === 'operations' && typeof document.deviceId === 'string') {
    rendered.deviceName = data.managedObjects.get(document.deviceId)?.name
  }
  return rendered
}

function notFound(resource: Resource, id: string): Response {
  return apiError(404, `${resource.domain}/Not Found`, `Finding ${resource.collection.slice(0, -1)} from database failed : No ${resource.collection.slice(0, -1)} for id '${id}'!`)
}

function invalid(message: string): Response {
  return apiError(422, 'undefined/validationError', message)
}

function checkEnum(field: string, value: unknown, allowed: readonly string[]): Response | undefined {
  return value !== undefined && !allowed.includes(String(value))
    ? invalid(`Invalid value '${String(value)}' for ${field}; allowed: ${allowed.join(', ')}`)
    : undefined
}

function omitServerFields(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([key]) => !SERVER_FIELDS.includes(key)))
}

/**
 * Creates a measurement, event, alarm, or operation with platform semantics
 * (validation, alarm deduplication, operation status PENDING).
 * @param data - Tenant data
 * @param resource - The resource
 * @param body - Request body
 * @returns The stored document, or an error response
 */
export function createDocument(data: TenantData, resource: Resource, body: Record<string, unknown>): StoredDocument | Response {
  const endpoint = `POST ${resource.path}` as C8yEndpoint
  const missing = checkRequired(endpoint, body)
  if (missing) {
    return missing
  }
  const now = store.now()
  const source = resource.collection === 'operations' ? body.deviceId as string : sourceId(body)
  if (source !== undefined && !data.managedObjects.has(String(source))) {
    return invalid(`Source with id '${String(source)}' does not exist`)
  }

  if (resource.collection === 'alarms') {
    const error = checkEnum('severity', body.severity, C8Y_ENUMS.alarmSeverity) ?? checkEnum('status', body.status, C8Y_ENUMS.alarmStatus)
    if (error) {
      return error
    }
    // Deduplication: an active or acknowledged alarm of the same source and
    // type is updated (count, time) instead of creating a new one.
    const existing = [...data.alarms.values()].find((alarm) =>
      sourceId(alarm) === source && alarm.type === body.type && alarm.status !== 'CLEARED')
    if (existing && body.status !== 'CLEARED') {
      existing.count = (existing.count as number) + 1
      existing.time = body.time
      existing.lastUpdated = now
      return existing
    }
  }

  const document: StoredDocument = {
    ...omitServerFields(body),
    id: store.newId(),
    creationTime: now,
  }
  if (source !== undefined && resource.collection !== 'operations') {
    document.source = { id: String(source) }
  }
  if (resource.collection !== 'measurements') {
    document.lastUpdated = now
  }
  if (resource.collection === 'alarms') {
    document.status ??= 'ACTIVE'
    document.count = 1
    document.firstOccurrenceTime = body.time
  }
  if (resource.collection === 'operations') {
    document.status = 'PENDING'
    delete document.failureReason
  }
  data[resource.collection].set(document.id, document)
  return document
}

/**
 * Applies an update to a stored document (fragments merged, `null` removes).
 * @param resource - The resource
 * @param document - Stored document
 * @param body - Update
 * @returns An error response, if invalid
 */
export function updateDocument(resource: Resource, document: StoredDocument, body: Record<string, unknown>): Response | undefined {
  const readOnly = resource.collection === 'operations' ? ['deviceId'] : ['source', 'time', 'type']
  if (resource.collection === 'alarms') {
    const error = checkEnum('severity', body.severity, C8Y_ENUMS.alarmSeverity) ?? checkEnum('status', body.status, C8Y_ENUMS.alarmStatus)
    if (error) {
      return error
    }
  }
  if (resource.collection === 'operations') {
    const error = checkEnum('status', body.status, C8Y_ENUMS.operationStatus)
    if (error) {
      return error
    }
  }
  for (const [key, value] of Object.entries(omitServerFields(body))) {
    if (readOnly.includes(key)) {
      continue
    }
    if (value === null) {
      delete document[key]
    } else {
      document[key] = value
    }
  }
  if (resource.collection !== 'measurements') {
    document.lastUpdated = store.now()
  }
  return undefined
}

function list(call: C8yRequest, data: TenantData, resource: Resource): StoredDocument[] {
  const { query } = call
  const values = (name: string) => query[name]?.split(',').map((value) => value.trim())
  let items = [...data[resource.collection].values()]

  if (query.source) {
    items = items.filter((document) => sourceId(document) === query.source)
  }
  if (query.deviceId) {
    items = items.filter((document) => document.deviceId === query.deviceId)
  }
  if (query.type) {
    const types = values('type')!
    items = items.filter((document) => types.includes(String(document.type)))
  }
  if (query.status) {
    const statuses = values('status')!
    items = items.filter((document) => statuses.includes(String(document.status)))
  }
  if (query.severity) {
    const severities = values('severity')!
    items = items.filter((document) => severities.includes(String(document.severity)))
  }
  if (query.resolved !== undefined) {
    const resolved = flag(call, 'resolved')
    items = items.filter((document) => (document.status === 'CLEARED') === resolved)
  }
  if (query.fragmentType) {
    items = items.filter((document) => document[query.fragmentType!] !== undefined)
  }
  if (query.valueFragmentType) {
    items = items.filter((document) => {
      const fragment = document[query.valueFragmentType!] as Record<string, unknown> | undefined
      return fragment !== undefined && (query.valueFragmentSeries === undefined || fragment[query.valueFragmentSeries] !== undefined)
    })
  }
  const timeField = resource.collection === 'operations' ? 'creationTime' : 'time'
  if (query.dateFrom !== undefined || query.dateTo !== undefined) {
    items = items.filter((document) => inRange(document[timeField], query.dateFrom, query.dateTo))
  }
  if (query.createdFrom !== undefined || query.createdTo !== undefined) {
    items = items.filter((document) => inRange(document.creationTime, query.createdFrom, query.createdTo))
  }
  if (query.lastUpdatedFrom !== undefined || query.lastUpdatedTo !== undefined) {
    items = items.filter((document) => inRange(document.lastUpdated, query.lastUpdatedFrom, query.lastUpdatedTo))
  }

  // Default orders from the spec: measurements oldest first, events and
  // alarms newest first, operations by ascending id; `revert` flips them.
  const revert = flag(call, 'revert')
  switch (resource.collection) {
    case 'measurements':
      return byTime(items, 'time', revert)
    case 'events':
      return byTime(items, 'time', !revert)
    case 'alarms':
      return byTime(items, 'time', true)
    default:
      return revert ? [...items].reverse() : items
  }
}

/**
 * Measurement, event, alarm, and operation APIs.
 * @param call - The request
 * @param segments - Path segments
 * @param data - Tenant data
 * @param resource - The resource
 */
export function documents(call: C8yRequest, segments: string[], data: TenantData, resource: Resource): Response | undefined {
  const [, , id, extra] = segments
  const { method } = call
  const collection = data[resource.collection]
  const body = (call.body ?? {}) as Record<string, unknown>

  if (extra !== undefined) {
    return undefined
  }

  if (id === undefined) {
    if (method === 'GET') {
      checkQuery(`GET ${resource.path}` as C8yEndpoint, call, resource.listParams)
      return paged(call, resource.collection, list(call, data, resource).map((document) => renderDocument(data, resource, document)), resource.path)
    }
    if (method === 'POST') {
      checkQuery(`POST ${resource.path}` as C8yEndpoint, call, [])
      // measurement collections: { measurements: [...] }
      if (resource.collection === 'measurements' && Array.isArray(body.measurements)) {
        const created: StoredDocument[] = []
        for (const item of body.measurements as Record<string, unknown>[]) {
          const result = createDocument(data, resource, item)
          if (result instanceof Response) {
            return result
          }
          created.push(result)
        }
        return Response.json({ measurements: created.map((document) => renderDocument(data, resource, document)) }, { status: 201 })
      }
      const result = createDocument(data, resource, body)
      return result instanceof Response ? result : Response.json(renderDocument(data, resource, result), { status: 201 })
    }
    if (method === 'PUT' && resource.collection === 'alarms') {
      checkQuery('PUT /alarm/alarms', call, ['createdFrom', 'createdTo', 'dateFrom', 'dateTo', 'resolved', 'severity', 'source', 'status'])
      for (const alarm of list(call, data, resource)) {
        const error = updateDocument(resource, alarm, body)
        if (error) {
          return error
        }
      }
      return new Response(null, { status: 200 })
    }
    return undefined
  }

  const document = collection.get(id)
  const detail = `${resource.path}/{id}`
  if (method === 'GET') {
    checkQuery(`GET ${detail}` as C8yEndpoint, call, [])
    return document ? Response.json(renderDocument(data, resource, document)) : notFound(resource, id)
  }
  if (method === 'PUT' && resource.collection !== 'measurements') {
    checkQuery(`PUT ${detail}` as C8yEndpoint, call, [])
    if (!document) {
      return notFound(resource, id)
    }
    if (resource.collection === 'operations' && body.status === undefined) {
      return invalid('Following mandatory fields should be included: status')
    }
    const error = updateDocument(resource, document, body)
    return error ?? Response.json(renderDocument(data, resource, document))
  }
  if (method === 'DELETE' && (resource.collection === 'measurements' || resource.collection === 'events')) {
    checkQuery(`DELETE ${detail}` as C8yEndpoint, call, [])
    return collection.delete(id) ? new Response(null, { status: 204 }) : notFound(resource, id)
  }
  return undefined
}
