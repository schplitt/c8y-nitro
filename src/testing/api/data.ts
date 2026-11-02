import type { C8yRequest } from '../types'
import type { C8yEndpoint } from '../capabilities.generated'
import type { DocumentCollection, StoredDocument, TenantData } from '../store'
import { parentIds, store } from '../store'
import { C8Y_ENUMS } from '../capabilities.generated'
import { apiError, baseUrl, byTime, checkQuery, checkRequired, flag, inRange, paged, raw, sourceId } from './http'
import { moSelf } from './inventory'
import type { RealtimeApi } from '../realtime'
import { notify } from '../notify'

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

function publish(data: TenantData, resource: Resource, action: 'CREATE' | 'UPDATE' | 'DELETE', document: StoredDocument): void {
  const source = resource.collection === 'operations' ? document.deviceId as string | undefined : sourceId(document)
  const payload = action === 'DELETE' ? { id: document.id } : renderDocument(data, resource, document)
  notify(data, resource.collection as RealtimeApi, action, payload, source)
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

  if (resource.collection === 'operations' && !hasAgent(data, String(source))) {
    // verified against the platform
    return apiError(422, 'devicecontrol/Unprocessable Entity', `Agent for device '${String(source)}' does not exist in inventory!`)
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
      publish(data, resource, 'UPDATE', existing)
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
  publish(data, resource, 'CREATE', document)
  return document
}

/**
 * Whether a device is an agent (`com_cumulocity_model_Agent`) or has one
 * among its device parents, which the platform requires for operations.
 * @param data - Tenant data
 * @param deviceId - Device id
 * @param seen
 */
function hasAgent(data: TenantData, deviceId: string, seen = new Set<string>()): boolean {
  if (seen.has(deviceId)) {
    return false
  }
  seen.add(deviceId)
  if (data.managedObjects.get(deviceId)?.com_cumulocity_model_Agent !== undefined) {
    return true
  }
  return parentIds(data, deviceId, 'childDevices').some((parent) => hasAgent(data, parent, seen))
}

/**
 * Applies an update to a stored document (fragments merged, `null` removes).
 * @param data
 * @param resource - The resource
 * @param document - Stored document
 * @param body - Update
 * @returns An error response, if invalid
 */
export function updateDocument(data: TenantData, resource: Resource, document: StoredDocument, body: Record<string, unknown>): Response | undefined {
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
  publish(data, resource, 'UPDATE', document)
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

  // Default orders: measurements newest first (time series persistence,
  // verified against the platform; `revert=false` gives oldest first), events
  // and alarms newest first, operations by ascending id.
  const revert = flag(call, 'revert')
  switch (resource.collection) {
    case 'measurements':
      return byTime(items, 'time', call.query.revert === undefined ? true : revert)
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

  if (id === 'series' && resource.collection === 'measurements' && method === 'GET') {
    return series(call, data)
  }

  if (id === undefined) {
    if (method === 'DELETE' && (resource.collection === 'measurements' || resource.collection === 'events')) {
      const supported = resource.collection === 'measurements'
        ? ['dateFrom', 'dateTo', 'fragmentType', 'source', 'type']
        : ['createdFrom', 'createdTo', 'dateFrom', 'dateTo', 'fragmentType', 'source', 'type']
      checkQuery(`DELETE ${resource.path}` as C8yEndpoint, call, supported)
      if (resource.collection === 'measurements') {
        // verified against the platform
        const unaligned = ['dateFrom', 'dateTo'].some((name) => call.query[name] !== undefined && Date.parse(call.query[name]!) % 3_600_000 !== 0)
        if (unaligned) {
          return apiError(422, 'measurement/Invalid Data', 'Date from and date to parameters used for delete filter must be truncated to hour!')
        }
      }
      for (const document of list(call, data, resource)) {
        collection.delete(document.id)
        data.eventBinaries.delete(document.id)
        publish(data, resource, 'DELETE', document)
      }
      return new Response(null, { status: 204 })
    }
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
        const error = updateDocument(data, resource, alarm, body)
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
    const error = updateDocument(data, resource, document, body)
    return error ?? Response.json(renderDocument(data, resource, document))
  }
  if (method === 'DELETE' && (resource.collection === 'measurements' || resource.collection === 'events')) {
    checkQuery(`DELETE ${detail}` as C8yEndpoint, call, [])
    if (!document || !collection.delete(id)) {
      return notFound(resource, id)
    }
    data.eventBinaries.delete(id)
    publish(data, resource, 'DELETE', document)
    return new Response(null, { status: 204 })
  }
  return undefined
}

const INTERVAL_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }
const AGGREGATION_TYPES: Record<string, string> = { MINUTELY: '1m', HOURLY: '1h', DAILY: '1d' }

/**
 * Start of the aggregation bucket a time falls into (UTC; weeks start at the
 * Unix epoch's weekday, months/quarters/years on calendar boundaries).
 * @param time - Epoch milliseconds
 * @param interval - e.g. `15m`, `1h`, `1M`
 */
function bucketStart(time: number, interval: string): number {
  const match = /^([1-9]\d{0,2})([smhdwMqy])$/.exec(interval)
  if (!match) {
    throw new TypeError(interval)
  }
  const amount = Number(match[1])
  const unit = match[2]!
  if (unit in INTERVAL_MS) {
    const size = amount * INTERVAL_MS[unit]!
    return Math.floor(time / size) * size
  }
  const date = new Date(time)
  const months = { M: amount, q: amount * 3, y: amount * 12 }[unit as 'M' | 'q' | 'y']
  const index = date.getUTCFullYear() * 12 + date.getUTCMonth()
  const start = Math.floor(index / months) * months
  return Date.UTC(Math.floor(start / 12), start % 12, 1)
}

function aggregate(values: number[], fn: string): number {
  const sum = values.reduce((total, value) => total + value, 0)
  const avg = sum / values.length
  const variance = (divisor: number) => values.reduce((total, value) => total + (value - avg) ** 2, 0) / divisor
  switch (fn) {
    case 'min': return Math.min(...values)
    case 'max': return Math.max(...values)
    case 'sum': return sum
    case 'avg': return avg
    case 'count': return values.length
    case 'stdDevPop': return Math.sqrt(variance(values.length))
    default: return values.length > 1 ? Math.sqrt(variance(values.length - 1)) : 0
  }
}

/**
 * `GET /measurement/measurements/series`: values of a source's series in a
 * period, optionally aggregated per interval.
 * @param call - The request
 * @param data - Tenant data
 */
function series(call: C8yRequest, data: TenantData): Response {
  checkQuery('GET /measurement/measurements/series', call, ['aggregationFunction', 'aggregationInterval', 'aggregationType', 'dateFrom', 'dateTo', 'revert', 'series', 'source'])
  const { query } = call
  const params = raw(call).params
  const missing = ['source', 'dateFrom', 'dateTo'].filter((name) => !query[name])
  if (missing.length > 0) {
    return apiError(422, 'measurement/Invalid Data', `Missing mandatory parameters: ${missing.join(', ')}`)
  }
  const functions = params.getAll('aggregationFunction')
  const interval = query.aggregationInterval ?? (query.aggregationType ? AGGREGATION_TYPES[query.aggregationType] : undefined)
  if (query.aggregationType && !C8Y_ENUMS.seriesAggregationType.includes(query.aggregationType as any)) {
    return apiError(422, 'measurement/Invalid Data', `Invalid aggregationType '${query.aggregationType}'`)
  }
  if (functions.length > 0 && !query.aggregationInterval) {
    return apiError(400, 'measurement/Bad Request', 'aggregationFunction requires aggregationInterval')
  }
  const unknownFunction = functions.find((fn) => !C8Y_ENUMS.seriesAggregationFunction.includes(fn as any))
  if (unknownFunction) {
    return apiError(422, 'measurement/Invalid Data', `Invalid aggregationFunction '${unknownFunction}'`)
  }
  if (interval && !/^[1-9]\d{0,2}[smhdwMqy]$/.test(interval)) {
    return apiError(422, 'measurement/Invalid Data', `Invalid aggregationInterval '${interval}'`)
  }
  const wanted = params.getAll('series')

  // series = fragment.series pairs with a numeric `value`
  const points: Array<{ time: number, key: string, value: number, unit?: string, type: string, name: string }> = []
  for (const measurement of data.measurements.values()) {
    if (sourceId(measurement) !== query.source || !inRange(measurement.time, query.dateFrom, query.dateTo)) {
      continue
    }
    for (const [fragment, fragmentValue] of Object.entries(measurement)) {
      if (!fragmentValue || typeof fragmentValue !== 'object' || Array.isArray(fragmentValue) || fragment === 'source') {
        continue
      }
      for (const [name, entry] of Object.entries(fragmentValue as Record<string, any>)) {
        if (entry && typeof entry === 'object' && typeof entry.value === 'number') {
          const key = `${fragment}.${name}`
          if (wanted.length === 0 || wanted.includes(key)) {
            points.push({ time: Date.parse(String(measurement.time)), key, value: entry.value, unit: entry.unit, type: fragment, name })
          }
        }
      }
    }
  }
  const seriesList: Array<{ key: string, name: string, type: string, unit?: string }> = []
  for (const point of points) {
    if (!seriesList.some((item) => item.key === point.key)) {
      seriesList.push({ key: point.key, name: point.name, type: point.type, unit: point.unit })
    }
  }
  const buckets = new Map<number, Map<string, number[]>>()
  for (const point of points) {
    const time = interval ? bucketStart(point.time, interval) : point.time
    const bucket = buckets.get(time) ?? new Map<string, number[]>()
    bucket.set(point.key, [...(bucket.get(point.key) ?? []), point.value])
    buckets.set(time, bucket)
  }
  // oldest first unless revert=true (verified against the platform)
  const times = [...buckets.keys()].sort((a, b) => flag(call, 'revert') ? b - a : a - b)
  const fns = functions.length > 0 ? functions : ['min', 'max']
  const values: Record<string, Array<Record<string, number> | null>> = {}
  for (const time of times) {
    const bucket = buckets.get(time)!
    values[new Date(time).toISOString()] = seriesList.map((item) => {
      const numbers = bucket.get(item.key)
      return numbers ? Object.fromEntries(fns.map((fn) => [fn, aggregate(numbers, fn)])) : null
    })
  }
  return Response.json({
    values,
    series: seriesList.map(({ name, type, unit }) => ({ name, type, ...(unit !== undefined ? { unit } : {}) })),
    truncated: false,
  })
}
