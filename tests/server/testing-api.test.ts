// Tests for c8y-nitro/testing itself: scoping, stacking, reset, overrides, and
// errors. Tests in this file are order-dependent on purpose (they check that
// nothing leaks from one test to the next), so they run in order.
import { beforeAll, describe, expect, it } from 'vitest'
import { c8y } from 'c8y-nitro/testing'
import { fetchJson } from './utils'

// file level: every test sees this device and this option
const pump = c8y.device({ name: 'file-pump' })
c8y.tenantOptions.set('scopeOption', 'file')

const deviceName = async () => (await fetchJson(`/devices/${pump.id}`)).json.name

describe('scopes', () => {
  it('applies file-level arrangements', async () => {
    expect(await deviceName()).toBe('file-pump')
    expect(c8y.tenantOptions.get('scopeOption')).toBe('file')
  })

  describe('a describe', () => {
    c8y.override('GET /inventory/managedObjects/:id', ({ params }) => ({ id: params.id, name: 'describe-override' }))
    c8y.tenantOptions.set('scopeOption', 'describe')

    it('overrides the file level', async () => {
      expect(await deviceName()).toBe('describe-override')
      expect(c8y.tenantOptions.get('scopeOption')).toBe('describe')
    })

    describe('a nested describe', () => {
      c8y.tenantOptions.set('scopeOption', 'nested')

      it('inherits what it does not override', async () => {
        expect(await deviceName()).toBe('describe-override')
        expect(c8y.tenantOptions.get('scopeOption')).toBe('nested')
      })
    })

    it('lets a test override for itself', async () => {
      c8y.override('GET /inventory/managedObjects/:id', ({ params }) => ({ id: params.id, name: 'test-override' }))
      expect(await deviceName()).toBe('test-override')
    })

    it('does not leak test-level overrides into the next test', async () => {
      expect(await deviceName()).toBe('describe-override')
    })
  })

  it('restores the file level after a describe', async () => {
    expect(await deviceName()).toBe('file-pump')
    expect(c8y.tenantOptions.get('scopeOption')).toBe('file')
  })

  let firstId: string | undefined
  it('rebuilds data before every test', () => {
    firstId = pump.id
    expect(c8y.db.managedObjects.find({ name: 'file-pump' })).toHaveLength(1)
  })

  it('gives rebuilt data the same ids in every test', () => {
    expect(pump.id).toBe(firstId)
    expect(c8y.db.managedObjects.find({ name: 'file-pump' })).toHaveLength(1)
  })
})

describe('overrides', () => {
  it('answers only the first request with once', async () => {
    c8y.override('GET /inventory/managedObjects/:id', () => ({ id: 'x', name: 'once' }), { once: true })

    expect(await deviceName()).toBe('once')
    expect(await deviceName()).toBe('file-pump')
  })

  it('can answer with any status through a Response', async () => {
    c8y.override('GET /inventory/**', () => Response.json({ message: 'Unavailable' }, { status: 503 }))

    // @c8y/client throws { res, data } on error statuses; the c8y-client
    // middleware turns upstream errors into a 500
    expect((await fetchJson(`/devices/${pump.id}`)).res.status).toBe(500)
  })

  it('passes a request on to the platform with next()', async () => {
    c8y.override('GET /inventory/managedObjects/:id', async ({ next }) => ({ ...await (await next()).json() as object, name: 'via-next' }))

    expect(await deviceName()).toBe('via-next')
  })

  it('answers 500 when a handler throws, and records the failure', async () => {
    // 'error' (the default) would fail this test after it ran
    c8y.apply({ onUnhandledRequest: 'ignore' })
    c8y.override('GET /features', () => {
      throw new TypeError('fetch failed')
    })

    const { json } = await fetchJson('/platform/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant: c8y.tenant, method: 'GET', path: '/features' }),
    })

    expect(json).toEqual({ status: 500 })
    expect(c8y.unhandled).toMatchObject([{ method: 'GET', path: '/features', kind: 'error' }])
  })

  it('gives the handler the request', async () => {
    let context: unknown
    c8y.override('POST /event/:kind', (ctx) => {
      context = ctx
      return Response.json({}, { status: 201 })
    })

    const { json } = await fetchJson('/platform/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant: c8y.tenant, method: 'POST', path: '/event/events?source=1', body: { type: 'door_open' } }),
    })

    expect(json).toEqual({ status: 201 })
    expect(context).toMatchObject({
      method: 'POST',
      path: '/event/events',
      query: { source: '1' },
      body: { type: 'door_open' },
      headers: expect.objectContaining({ 'content-type': 'application/json' }),
      tenant: c8y.tenant,
      user: expect.stringMatching(/^service_/),
      params: { kind: 'events' },
      request: expect.any(Request),
      callCount: 1,
      next: expect.any(Function),
    })
  })

  it('counts the requests an override got', async () => {
    c8y.override('GET /inventory/managedObjects/:id', ({ callCount, next }) => callCount === 1 ? Response.json({ message: 'Unavailable' }, { status: 503 }) : next())

    expect((await fetchJson(`/devices/${pump.id}`)).res.status).toBe(500)
    expect(await deviceName()).toBe('file-pump')
  })
})

describe('tenant options', () => {
  c8y.tenantOptions.set('myOption', 'file-value')

  describe('deleted in a describe', () => {
    c8y.tenantOptions.delete('myOption')

    it('is gone in that describe', async () => {
      expect(c8y.tenantOptions.get('myOption')).toBeUndefined()
    })
  })

  it('is back outside of it', async () => {
    expect(c8y.tenantOptions.get('myOption')).toBe('file-value')
  })
})

// the fixture's manifest (tests/server/fixture/nitro.config.ts) shapes the fake tenant
describe('the manifest', () => {
  const platformRequest = (method: string, path: string, body?: unknown) => fetchJson('/platform/request', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tenant: c8y.tenant, method, path, body }),
  })

  it('gives the service users only its requiredRoles', async () => {
    // ROLE_INVENTORY_READ is required, ROLE_INVENTORY_ADMIN is not
    expect((await platformRequest('GET', '/inventory/managedObjects')).json).toEqual({ status: 200 })
    expect((await platformRequest('POST', '/inventory/managedObjects', { name: 'pump' })).json).toEqual({ status: 403 })
  })

  it('stores its settings defaults as tenant options', async () => {
    const { json } = await fetchJson('/tenant-options')

    expect(json).toMatchObject({ 'myOption': 'default', 'credentials.secret': 'change-me', 'cacheExpiryOption': 'cache-default' })
  })

  describe('with a user that has its roles', () => {
    // not seeded as roles: the manifest's roles exist in the tenant already
    c8y.seed({ users: [{ userName: 'manifest-user', roles: ['SOME_CUSTOM_ROLE', 'ANOTHER_ROLE'] }] })

    it('has them in the tenant', async () => {
      const { json } = await fetchJson('/user', { as: 'manifest-user' })

      expect(json.roles).toEqual(expect.arrayContaining(['SOME_CUSTOM_ROLE', 'ANOTHER_ROLE']))
    })
  })
})

describe('call log', () => {
  it('records platform requests', async () => {
    await deviceName()

    expect(c8y).toHaveReceived('GET /inventory/managedObjects/:id', { times: 1 })
    expect(c8y).not.toHaveReceived('POST /inventory/**')
    expect(c8y.callsTo('GET /inventory/**')[0]).toMatchObject({ method: 'GET', path: `/inventory/managedObjects/${pump.id}`, tenant: c8y.tenant })
  })

  it('starts every test with an empty call log', () => {
    expect(c8y.calls).toEqual([])
  })
})

describe('unsupported requests', () => {
  it('answers 501 and records them with a reason', async () => {
    // 'error' (the default) would fail this test after it ran
    c8y.apply({ onUnhandledRequest: 'ignore' })

    const { json } = await fetchJson('/platform/features')

    // the message names c8y.override(), the way to answer it in a c8y-nitro test
    expect(json).toMatchObject({ status: 501, body: { message: 'GET /features: endpoint not emulated by the fake Cumulocity platform. Answer it with c8y.override(\'GET /features\', ...).' } })
    expect(c8y.unhandled).toMatchObject([{ method: 'GET', path: '/features', reason: 'endpoint not emulated', kind: 'endpoint' }])
  })

  it('can be answered with an override', async () => {
    c8y.override('GET /features', () => [{ key: 'my-feature', active: true }])

    expect((await fetchJson('/platform/features')).json).toEqual({ status: 200, body: [{ key: 'my-feature', active: true }] })
  })
})

describe('misuse', () => {
  let beforeAllError: unknown

  beforeAll(() => {
    try {
      c8y.tenantOptions.set('nope', 'nope')
    } catch (error) {
      beforeAllError = error
    }
  })

  it('rejects arrange calls in beforeAll', () => {
    expect(String(beforeAllError)).toContain('cannot be used in beforeAll()')
  })
})
