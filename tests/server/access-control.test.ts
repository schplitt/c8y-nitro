import { describe, expect, it } from 'vitest'
import { c8y } from 'c8y-nitro/testing'
import { fetchJson, readJson } from './utils'

// Personas: users that call the service. Plain fetchJson() calls as the
// default user from the c8yTest() config.
const inventoryReader = c8y.persona({ userName: 'testUser', roles: ['ROLE_INVENTORY_READ', 'ROLE_ALARM_READ', 'ROLE_DEVICE_CONTROL'] })
const someUser = c8y.persona({ userName: 'someUser', roles: ['SOME_CUSTOM_ROLE'] })
const admin = c8y.persona({ userName: 'adminUser', roles: ['ADMIN_ROLE', 'ROLE_B'] })
const anonymous = c8y.persona(null)
const otherTenantUser = c8y.persona({ userName: 'testUser', roles: [], tenant: 't00000' })
const subscribedTenantUser = c8y.persona({ userName: 'testUser', roles: [], tenant: 't99999' })

describe('user resources', () => {
  it('returns the current user and their roles', async () => {
    const res = await inventoryReader.fetch('/user')
    const json = await readJson(res)

    expect(res.status).toBe(200)
    expect(json.userName).toBe('testUser')
    expect(json.roles).toEqual(['ROLE_INVENTORY_READ', 'ROLE_ALARM_READ', 'ROLE_DEVICE_CONTROL'])
  })

  it('fails when the platform rejects the caller', async () => {
    const res = await anonymous.fetch('/user')

    // The platform answers 401; @c8y/client throws { res, data } and the
    // c8y-client middleware turns upstream errors into a 500.
    expect(res.status).toBe(500)
    expect(c8y).toHaveReceived('GET /user/currentUser')
  })

  it('calls as the default user without a persona', async () => {
    expect((await fetchJson('/user')).json.userName).toBe('test-user')
  })
})

describe('role middleware', () => {
  it('compares the caller\'s roles in a single test', async () => {
    expect((await someUser.fetch('/protectedRoute')).status).toBe(403)
    expect((await admin.fetch('/protectedRoute')).status).toBe(200)
  })

  it('names the missing role', async () => {
    const json = await readJson(await someUser.fetch('/protectedRoute'))

    expect(json.message).toBe('User does not have required role(s) to access this resource: ADMIN_ROLE')
  })

  it('accepts any one of several roles', async () => {
    const denied = await readJson(await someUser.fetch('/protected-multi-role'))
    expect(denied.message).toContain('ROLE_A')
    expect(denied.message).toContain('ROLE_B')

    const allowed = await admin.fetch('/protected-multi-role')
    expect(allowed.status).toBe(200)
    expect((await readJson(allowed)).message).toBe('You have one of the required roles!')
  })
})

describe('tenant middleware', () => {
  it('allows an allowed tenant and denies others', async () => {
    expect((await readJson(await inventoryReader.fetch('/tenant-restricted'))).message).toBe('Your tenant is allowed!')

    const denied = await otherTenantUser.fetch('/tenant-restricted')
    const json = await readJson(denied)
    expect(denied.status).toBe(403)
    expect(json.message).toContain('t00000')
    expect(json.message).toContain('not allowed')
  })

  it('allows only users of the deployed tenant', async () => {
    expect((await readJson(await inventoryReader.fetch('/deployed-tenant-only'))).message).toBe('You are from the deployed tenant!')

    const denied = await subscribedTenantUser.fetch('/deployed-tenant-only')
    expect(denied.status).toBe(403)
    expect((await readJson(denied)).message).toContain(c8y.tenant)
  })
})
