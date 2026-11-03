// The fake tenant against the OpenAPI spec: every response of every emulated
// endpoint has a documented status and matches the documented schema, and
// documented defaults hold. The schemas come from tests/contract/spec.generated.json
// (pnpm gen:testing-capabilities). Where the platform itself deviates from the
// spec, docs/reference/platform-behavior.md lists it and tests/contract/deviations.ts
// allows it. The fake answers `application/json` where the platform uses its
// vendor media types; the media type itself is not compared.
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { BasicAuth, Client } from '@c8y/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { c8y } from 'c8y-nitro/testing'
import { C8Y_ENDPOINTS } from '../../src/testing/capabilities.generated'
import type { C8yEndpoint } from '../../src/testing/capabilities.generated'
import { DEVIATIONS, EMPTY_BODY_DEVIATIONS, SCHEMA_DEVIATIONS } from '../contract/deviations'
import spec from '../contract/spec.generated.json' with { type: 'json' }
import { checkSchema } from '../contract/schema'
import type { Schema } from '../contract/schema'

/**
 * Documented success statuses no request can reach on the fake, with the reason.
 */
const UNREACHABLE: Record<string, string> = {
  'POST /inventory/managedObjects 200': 'the platform answers 201 (200 is listed for an upsert the fake does not emulate)',
  'DELETE /inventory/managedObjects/{id} 202': 'the asynchronous (cascading) delete of a large hierarchy',
  'GET /measurement/measurements/{id} 200': 'time series persistence answers 405 (measurement-by-id-405)',
  'PUT /alarm/alarms 202': 'the platform answers 200 for a small bulk update; 202 is the asynchronous one',
  'POST /notification2/unsubscribe 200': 'the platform answers 204 (unsubscribe-statuses)',
}

/**
 * The shape of every error body (the spec's `error` schema).
 */
const ERROR_SCHEMA: Schema = { type: 'object', required: ['error', 'message'], properties: { error: { type: 'string' }, message: { type: 'string' }, info: { type: 'string' } } }

const client = new Client(new BasicAuth({ tenant: c8y.tenant, user: 'test-user', password: 'contract-password' }), process.env.C8Y_BASEURL)
const checked = new Set<string>()
const usedDeviations = new Set<string>()
const problems: string[] = []

function endpointOf(method: string, path: string): C8yEndpoint | undefined {
  const candidates = (Object.keys(C8Y_ENDPOINTS) as C8yEndpoint[]).filter((endpoint) => {
    const [m, template] = endpoint.split(' ') as [string, string]
    return m === method && new RegExp(`^${template.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(path)
  })
  // a literal path (`/measurement/measurements/series`) wins over `{id}`
  return candidates.sort((a, b) => (a.split('{').length) - (b.split('{').length))[0]
}

/**
 * Sends a request to the fake and checks the response against the spec.
 * @param method
 * @param path
 * @param body
 * @param headers
 */
async function request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number, json: any }> {
  const raw = body === undefined || typeof body === 'string' || body instanceof Uint8Array || body instanceof FormData
  const res = await client.core.fetch(path, {
    method,
    headers: { accept: 'application/json', ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : (raw ? body as any : JSON.stringify(body)),
  })
  const text = await res.text()
  let json: any
  try {
    json = JSON.parse(text)
  } catch {}
  const endpoint = endpointOf(method, path.split('?')[0]!)
  expect(endpoint, `${method} ${path} is not an emulated endpoint`).toBeDefined()
  const documented = (spec.responses as Record<string, Record<string, Record<string, Schema>>>)[endpoint!]!
  const label = `${method} ${path} → ${res.status}`
  checked.add(`${endpoint} ${res.status}`)
  const deviation = DEVIATIONS[endpoint!]?.[res.status]
  const emptyBody = EMPTY_BODY_DEVIATIONS[endpoint!]?.[res.status]
  if (deviation) {
    usedDeviations.add(`${endpoint} ${res.status}`)
  } else if (emptyBody) {
    usedDeviations.add(`${endpoint} ${res.status}`)
    if (text !== '') {
      problems.push(`${label}: expected an empty body (${emptyBody}), got ${JSON.stringify(text.slice(0, 80))}`)
    }
    return { status: res.status, json }
  } else if (!documented[res.status]) {
    problems.push(`${label}: status not documented (documented: ${Object.keys(documented).join(', ')})`)
    return { status: res.status, json }
  }
  // an undocumented error status still has the platform's error body; a
  // documented body is only checked for JSON media types (binaries are bytes)
  const schemas = deviation
    ? (res.status >= 400 ? [ERROR_SCHEMA] : [])
    : Object.entries(documented[res.status] ?? {}).filter(([mediaType]) => mediaType.includes('json')).map(([, schema]) => schema)
  if (schemas.length > 0) {
    if (json === undefined) {
      problems.push(`${label}: expected a JSON body, got ${JSON.stringify(text.slice(0, 80))}`)
      return { status: res.status, json }
    }
    const results = schemas.map((schema) => checkSchema(json, schema).filter((problem) => {
      const matched = SCHEMA_DEVIATIONS.find((item) => item.problem.test(problem))
      if (matched) {
        usedDeviations.add(matched.id)
      }
      return !matched
    }))
    if (!results.some((result) => result.length === 0)) {
      problems.push(`${label}: ${results[0]!.join('; ')}`)
    }
  }
  return { status: res.status, json }
}

const q = (params: Record<string, string | number | boolean>) => new URLSearchParams(Object.entries(params).map(([key, value]): [string, string] => [key, String(value)])).toString()
const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 10, minute)).toISOString()

describe('the fake tenant against the OpenAPI spec', { concurrent: false }, () => {
  beforeEach(() => {
    problems.length = 0
  })

  it('answers every emulated endpoint with a documented status and schema', async () => {
    const { json: device } = await request('POST', '/inventory/managedObjects', { name: 'Pump', type: 'c8y_Pump', c8y_IsDevice: {}, com_cumulocity_model_Agent: {} })
    const { json: child } = await request('POST', '/inventory/managedObjects', { name: 'Sensor', c8y_IsDevice: {} })
    await request('GET', `/inventory/managedObjects?${q({ pageSize: 2, withTotalPages: true, withTotalElements: true, withParents: true })}`)
    await request('GET', `/inventory/managedObjects?${q({ query: `$filter=(has(c8y_IsDevice)) $orderby=name asc` })}`)
    await request('GET', `/inventory/managedObjects?${q({ query: `$filter=(name ne 'x')` })}`)
    await request('GET', `/inventory/managedObjects/${device.id}?withChildren=false`)
    await request('GET', '/inventory/managedObjects/9999')
    await request('PUT', `/inventory/managedObjects/${device.id}`, { c8y_Extra: { a: 1 } })
    await request('PUT', '/inventory/managedObjects/9999', { name: 'x' })
    for (const kind of ['childDevices', 'childAssets', 'childAdditions']) {
      await request('POST', `/inventory/managedObjects/${device.id}/${kind}`, { managedObject: { id: child.id } })
      await request('POST', `/inventory/managedObjects/9999/${kind}`, { managedObject: { id: child.id } })
      await request('GET', `/inventory/managedObjects/${device.id}/${kind}?withTotalPages=true`)
      await request('GET', `/inventory/managedObjects/9999/${kind}`)
      await request('DELETE', `/inventory/managedObjects/${device.id}/${kind}/${child.id}`)
      await request('DELETE', `/inventory/managedObjects/${device.id}/${kind}/${child.id}`)
    }

    await request('POST', `/identity/globalIds/${device.id}/externalIds`, { type: 'c8y_Serial', externalId: 'SN-1' })
    await request('POST', `/identity/globalIds/${child.id}/externalIds`, { type: 'c8y_Serial', externalId: 'SN-1' })
    await request('POST', `/identity/globalIds/${device.id}/externalIds`, { type: 'c8y_Serial' })
    await request('GET', `/identity/globalIds/${device.id}/externalIds`)
    await request('GET', '/identity/externalIds/c8y_Serial/SN-1')
    await request('GET', '/identity/externalIds/c8y_Serial/unknown')
    await request('DELETE', '/identity/externalIds/c8y_Serial/SN-1')
    await request('DELETE', '/identity/externalIds/c8y_Serial/SN-1')

    const source = { id: device.id }
    const { json: measurement } = await request('POST', '/measurement/measurements', { source, type: 'c8y_T', time: at(0), c8y_Temperature: { T: { value: 21.5, unit: 'C' } } })
    await request('POST', '/measurement/measurements', { measurements: [{ source, type: 'c8y_T', time: at(1), c8y_Temperature: { T: { value: 22, unit: 'C' } } }] })
    await request('POST', '/measurement/measurements', { source, type: 'c8y_T' })
    await request('POST', '/measurement/measurements', { source, type: 'c8y_T', time: 'garbage', c8y_T: { T: { value: 1 } } })
    await request('GET', `/measurement/measurements?${q({ source: device.id, dateFrom: at(0), dateTo: at(5), withTotalPages: true })}`)
    await request('GET', `/measurement/measurements?${q({ dateFrom: 'yesterday' })}`)
    await request('GET', `/measurement/measurements/${measurement.id}`)
    await request('GET', `/measurement/measurements/series?${q({ source: device.id, dateFrom: at(0), dateTo: at(5), aggregationInterval: '1m', aggregationFunction: 'avg' })}`)
    await request('GET', `/measurement/measurements/series?${q({ source: device.id, dateFrom: at(0), dateTo: at(5) })}`)
    await request('GET', `/measurement/measurements/series?${q({ source: device.id })}`)
    await request('GET', `/measurement/measurements/series?${q({ source: device.id, dateFrom: at(0), dateTo: at(5), aggregationFunction: 'avg' })}`)
    await request('DELETE', `/measurement/measurements/${measurement.id}`)
    await request('DELETE', `/measurement/measurements/${measurement.id}`)
    await request('DELETE', `/measurement/measurements?${q({ source: device.id })}`)

    const { json: event } = await request('POST', '/event/events', { source, type: 'c8y_Note', text: 'hi', time: at(0) })
    await request('POST', '/event/events', { source, type: 'c8y_Note', text: 'hi', time: 'garbage' })
    await request('POST', '/event/events', { source: { id: '9999' }, type: 'c8y_Note', text: 'hi', time: at(0) })
    await request('GET', `/event/events?${q({ source: device.id, withSourceChildren: true, withTotalElements: true })}`)
    await request('GET', `/event/events?${q({ source: '9999', withSourceAssets: true })}`)
    await request('GET', `/event/events?${q({ dateFrom: '2026-01-01T10:00Z' })}`)
    await request('GET', `/event/events/${event.id}`)
    await request('GET', '/event/events/9999')
    await request('PUT', `/event/events/${event.id}`, { text: 'updated' })
    await request('PUT', `/event/events/${event.id}`, { time: at(2) })
    await request('POST', `/event/events/${event.id}/binaries`, 'hello', { 'content-type': 'text/plain' })
    await request('GET', `/event/events/${event.id}/binaries`)
    await request('PUT', `/event/events/${event.id}/binaries`, 'hello again', { 'content-type': 'text/plain' })
    await request('DELETE', `/event/events/${event.id}/binaries`)
    await request('GET', `/event/events/${event.id}/binaries`)
    await request('DELETE', `/event/events/${event.id}`)
    await request('DELETE', `/event/events/${event.id}`)
    await request('DELETE', `/event/events?${q({ source: device.id })}`)

    const { json: alarm } = await request('POST', '/alarm/alarms', { source, type: 'c8y_Hot', text: 'hot', severity: 'MAJOR', time: at(0) })
    await request('POST', '/alarm/alarms', { source, type: 'c8y_Hot', text: 'hot', severity: 'MAJOR', time: at(1) })
    await request('POST', '/alarm/alarms', { source: { id: '9999' }, type: 'c8y_Hot', text: 'hot', severity: 'MAJOR', time: at(0) })
    await request('POST', '/alarm/alarms', { source, type: 'c8y_Hot', text: 'hot', severity: 'MAJOR', time: 'garbage' })
    await request('POST', '/alarm/alarms', { source, type: 'c8y_Hot', text: 'hot', time: at(0) })
    await request('GET', `/alarm/alarms?${q({ source: device.id, status: 'ACTIVE', withTotalPages: true })}`)
    await request('GET', `/alarm/alarms?${q({ source: device.id, resolved: true })}`)
    await request('GET', `/alarm/alarms?${q({ source: '9999', withSourceDevices: true })}`)
    await request('GET', `/alarm/alarms?${q({ dateFrom: 'yesterday' })}`)
    await request('GET', `/alarm/alarms/${alarm.id}`)
    await request('GET', '/alarm/alarms/9999')
    await request('PUT', `/alarm/alarms/${alarm.id}`, { status: 'ACKNOWLEDGED' })
    await request('PUT', `/alarm/alarms/${alarm.id}`, { type: 'changed' })
    await request('PUT', `/alarm/alarms?${q({ source: device.id })}`, { status: 'CLEARED' })
    await request('PUT', `/alarm/alarms?${q({ source: '9999', withSourceDevices: true })}`, { status: 'CLEARED' })

    const { json: operation } = await request('POST', '/devicecontrol/operations', { deviceId: device.id, c8y_Restart: {} })
    await request('POST', '/devicecontrol/operations', { deviceId: child.id, c8y_Restart: {} })
    await request('POST', '/devicecontrol/operations', { deviceId: device.id })
    await request('GET', `/devicecontrol/operations?${q({ deviceId: device.id, status: 'PENDING' })}`)
    await request('GET', `/devicecontrol/operations?${q({ status: 'BOGUS' })}`)
    await request('GET', `/devicecontrol/operations/${operation.id}`)
    await request('GET', '/devicecontrol/operations/9999')
    await request('PUT', `/devicecontrol/operations/${operation.id}`, { status: 'EXECUTING' })
    await request('PUT', `/devicecontrol/operations/${operation.id}`, { status: 'BOGUS' })

    const upload = new FormData()
    upload.append('object', JSON.stringify({ name: 'file.txt', type: 'text/plain' }))
    upload.append('file', new Blob([Buffer.from('content')], { type: 'text/plain' }), 'file.txt')
    const { json: binary } = await request('POST', '/inventory/binaries', upload)
    await request('GET', '/inventory/binaries?pageSize=1')
    await request('GET', `/inventory/binaries/${binary.id}`)
    await request('GET', '/inventory/binaries/9999')
    await request('PUT', `/inventory/binaries/${binary.id}`, 'new content', { 'content-type': 'text/plain' })
    await request('DELETE', `/inventory/binaries/${binary.id}`)
    await request('DELETE', `/inventory/binaries/${binary.id}`)
    await request('DELETE', `/inventory/managedObjects/${device.id}`)

    const { json: subscription } = await request('POST', '/notification2/subscriptions', { context: 'tenant', subscription: 'specsub', subscriptionFilter: { apis: ['alarms'] } })
    await request('POST', '/notification2/subscriptions', { context: 'tenant', subscription: 'specsub' })
    await request('POST', '/notification2/subscriptions', { context: 'mo', subscription: 'other', source: { id: '9999' } })
    await request('GET', '/notification2/subscriptions?context=tenant')
    await request('GET', `/notification2/subscriptions/${subscription.id}`)
    await request('GET', '/notification2/subscriptions/9999')
    const { json: token } = await request('POST', '/notification2/token', { subscriber: 'spec', subscription: 'specsub' })
    await request('POST', '/notification2/token', { subscription: 'specsub' })
    await request('POST', `/notification2/unsubscribe?token=${token.token}`)
    await request('POST', '/notification2/unsubscribe')
    await request('DELETE', `/notification2/subscriptions/${subscription.id}`)
    await request('DELETE', `/notification2/subscriptions/${subscription.id}`)
    await request('DELETE', '/notification2/subscriptions?context=tenant')

    expect(problems).toEqual([])
  })

  it('keeps the documented page size default and the paging limits', async () => {
    const { json: device } = await request('POST', '/inventory/managedObjects', { name: 'Pump', c8y_IsDevice: {}, com_cumulocity_model_Agent: {} })
    const lists: Array<[C8yEndpoint, string]> = [
      ['GET /inventory/managedObjects', '/inventory/managedObjects'],
      ['GET /inventory/managedObjects/{id}/childDevices', `/inventory/managedObjects/${device.id}/childDevices`],
      ['GET /measurement/measurements', '/measurement/measurements'],
      ['GET /event/events', '/event/events'],
      ['GET /alarm/alarms', '/alarm/alarms'],
      ['GET /devicecontrol/operations', '/devicecontrol/operations'],
      ['GET /inventory/binaries', '/inventory/binaries'],
      ['GET /notification2/subscriptions', '/notification2/subscriptions'],
    ]
    for (const [endpoint, path] of lists) {
      const params = (spec.parameters as Record<string, Record<string, { default?: unknown, minimum?: number, maximum?: number }>>)[endpoint]!
      const { json } = await request('GET', path)
      expect(json.statistics.pageSize, endpoint).toBe(params.pageSize!.default)
      expect(json.statistics.currentPage, endpoint).toBe(params.currentPage!.default)
      // `withTotalPages` and `withTotalElements` default to false
      expect(json.statistics, endpoint).not.toHaveProperty('totalElements')
      if (endpoint !== 'GET /inventory/binaries') {
        expect(json.statistics, endpoint).not.toHaveProperty('totalPages')
      }
      const { json: capped } = await request('GET', `${path}?pageSize=${params.pageSize!.maximum! + 1}`)
      expect(capped.statistics.pageSize, endpoint).toBe(params.pageSize!.maximum)
    }
    expect(problems).toEqual([])
  })

  // last on purpose: it sums up the requests of the tests above
  it('reached every documented success status and needed every deviation', () => {
    const unseen = (Object.keys(C8Y_ENDPOINTS) as C8yEndpoint[]).flatMap((endpoint) =>
      Object.keys((spec.responses as Record<string, Record<string, unknown>>)[endpoint] ?? {})
        .filter((status) => status.startsWith('2') && !checked.has(`${endpoint} ${status}`))
        .map((status) => `${endpoint} ${status}`),
    )
    expect(unseen.filter((status) => !UNREACHABLE[status]), 'documented success statuses no request reached').toEqual([])
    expect(Object.keys(UNREACHABLE).filter((status) => checked.has(status)), 'statuses listed as unreachable that a request reached').toEqual([])
    // every deviation is still needed
    const stale = [...Object.entries(DEVIATIONS), ...Object.entries(EMPTY_BODY_DEVIATIONS)].flatMap(([endpoint, statuses]) => Object.keys(statuses).map((status) => `${endpoint} ${status}`)).filter((key) => !usedDeviations.has(key))
    expect([...stale, ...SCHEMA_DEVIATIONS.map((item) => item.id).filter((id) => !usedDeviations.has(id))], 'deviations no response needed').toEqual([])
  })
})
