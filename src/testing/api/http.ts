import process from 'node:process'
import type { C8yRequest } from '../types'
import type { C8yEndpoint } from '../capabilities.generated'
import { C8Y_ENDPOINTS } from '../capabilities.generated'
import { DEFAULTS } from '../defaults'

/**
 * Thrown by an API handler for a request the fake cannot answer faithfully
 * (an endpoint feature it does not emulate). The test fails with the reason.
 */
export class UnsupportedRequestError extends Error {}

/**
 * Raw parts of a request handlers sometimes need (binary bodies, repeated params).
 */
export interface RawRequest {
  bytes: Uint8Array
  contentType: string
  params: URLSearchParams
}

export const rawRequests = new WeakMap<C8yRequest, RawRequest>()

/**
 * The raw parts of a request.
 * @param call - The request
 */
export function raw(call: C8yRequest): RawRequest {
  return rawRequests.get(call) ?? { bytes: new Uint8Array(), contentType: '', params: new URLSearchParams(call.query) }
}

/**
 * Base URL used in `self`/`next` links.
 */
export function baseUrl(): string {
  return (process.env.C8Y_BASEURL || DEFAULTS.baseUrl).replace(/\/+$/, '')
}

/**
 * Cumulocity-style error response.
 * @param status - HTTP status
 * @param error - Error code, e.g. `inventory/Not Found`
 * @param message - Human-readable message
 */
export function apiError(status: number, error: string, message: string): Response & { message: string } {
  // `message` is kept on the object for synchronous use (e.g. seeding errors)
  return Object.assign(Response.json({ error, message, info: 'https://cumulocity.com/guides/reference/rest-implementation' }, { status }), { message })
}

/**
 * Validates query parameters against the spec: parameters the real endpoint
 * knows but the fake does not emulate fail loudly; unknown parameters are
 * ignored, like the real API does.
 * @param endpoint - Endpoint key, e.g. `GET /inventory/managedObjects`
 * @param call - The request
 * @param supported - Parameters this fake endpoint emulates
 */
export function checkQuery(endpoint: C8yEndpoint, call: C8yRequest, supported: readonly string[]): void {
  const known: readonly string[] = C8Y_ENDPOINTS[endpoint].query
  for (const [name, value] of Object.entries(call.query)) {
    if (known.includes(name) && !supported.includes(name) && value !== '' && value !== 'false') {
      throw new UnsupportedRequestError(`query parameter "${name}" of ${endpoint} is not emulated`)
    }
  }
}

/**
 * Returns a 422 response if required body fields (from the spec) are missing.
 * @param endpoint - Endpoint key
 * @param body - Request body
 */
export function checkRequired(endpoint: C8yEndpoint, body: Record<string, unknown>): Response | undefined {
  const spec = C8Y_ENDPOINTS[endpoint] as { required?: readonly string[] }
  const missing = (spec.required ?? []).filter((field) => body[field] === undefined || body[field] === null)
  if (missing.length > 0) {
    return apiError(422, 'undefined/validationError', `Following mandatory fields should be included: ${missing.join(',')}`)
  }
  return undefined
}

/**
 * Reads a boolean query parameter.
 * @param call
 * @param name
 * @param fallback
 */
export function flag(call: C8yRequest, name: string, fallback = false): boolean {
  const value = call.query[name]
  return value === undefined ? fallback : value === 'true'
}

/**
 * Builds a paged collection response like Cumulocity's: `statistics`, `self`,
 * and `next`/`prev` links (`next` always, `prev` after the first page).
 * @param call - The request (paging params)
 * @param collection - Property name, e.g. `managedObjects`
 * @param items - All matching items, in result order
 * @param path - Collection path, e.g. `/inventory/managedObjects`
 * @param options - Paging options
 * @param options.statistics - `binaries`: always `totalPages`, never `totalElements`
 */
export function paged(call: C8yRequest, collection: string, items: unknown[], path: string, options: { statistics?: 'requested' | 'binaries' } = {}): Response {
  for (const name of ['pageSize', 'currentPage']) {
    const value = call.query[name]
    if (value !== undefined && !/^-?\d+$/.test(value)) {
      // verified against the platform
      return apiError(422, 'undefined/validationError', `Parameter '${name}' must have an integer value!`)
    }
  }
  // verified: 0 means 1, at most 2000
  const pageSize = Math.min(Math.max(Number.parseInt(call.query.pageSize ?? '5', 10), 1), 2000)
  const currentPage = Math.max(Number.parseInt(call.query.currentPage ?? '1', 10), 1)
  const page = items.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const link = (pageNumber: number) => {
    const params = new URLSearchParams({ ...call.query, pageSize: String(pageSize), currentPage: String(pageNumber) })
    return `${baseUrl()}${path}?${params}`
  }
  const statistics: Record<string, number> = { currentPage, pageSize }
  const totalPages = Math.ceil(items.length / pageSize)
  // verified: the binaries list always has totalPages and never totalElements
  const withTotalPages = options.statistics === 'binaries' || flag(call, 'withTotalPages')
  if (withTotalPages) {
    statistics.totalPages = totalPages
  }
  if (options.statistics !== 'binaries' && flag(call, 'withTotalElements')) {
    statistics.totalElements = items.length
  }
  return Response.json({
    self: link(currentPage),
    [collection]: page,
    statistics,
    // verified: the next page is linked even past the end, unless the total
    // page count is known
    ...(withTotalPages && currentPage >= totalPages ? {} : { next: link(currentPage + 1) }),
    ...(currentPage > 1 ? { prev: link(currentPage - 1) } : {}),
  })
}

/**
 * Filters documents by an inclusive-from, exclusive-to date range on a field.
 * @param value - ISO date of the document
 * @param from - Range start (inclusive)
 * @param to - Range end (exclusive)
 */
export function inRange(value: unknown, from: string | undefined, to: string | undefined): boolean {
  const time = Date.parse(String(value))
  if (from !== undefined && time < Date.parse(from)) {
    return false
  }
  if (to !== undefined && time >= Date.parse(to)) {
    return false
  }
  return true
}

/**
 * Sorts documents by a date field.
 * @param items - Documents
 * @param field - Date field
 * @param newestFirst - Sort descending
 */
export function byTime<T extends Record<string, unknown>>(items: T[], field: string, newestFirst: boolean): T[] {
  return [...items].sort((a, b) => {
    const diff = Date.parse(String(a[field])) - Date.parse(String(b[field]))
    return newestFirst ? -diff : diff
  })
}

/**
 * The source id of a measurement/event/alarm.
 * @param document
 */
export function sourceId(document: Record<string, unknown>): string | undefined {
  return (document.source as { id?: string } | undefined)?.id
}
