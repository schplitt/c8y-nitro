import { describe, expect, it } from 'vitest'
import { c8y } from 'c8y-nitro/testing'
import { fetchJson } from './utils'

// File level: every test in this file starts with this user …
c8y.user({ userName: 'testUser', roles: ['ROLE_INVENTORY_READ', 'ROLE_ALARM_READ', 'ROLE_DEVICE_CONTROL'] })

describe('user resources', () => {
  it('returns the current user and their roles', async () => {
    const { res, json } = await fetchJson('/user')

    expect(res.status).toBe(200)
    expect(json.userName).toBe('testUser')
    expect(json.roles).toEqual(['ROLE_INVENTORY_READ', 'ROLE_ALARM_READ', 'ROLE_DEVICE_CONTROL'])
  })

  it('fails when the platform rejects the current user', async () => {
    // … and a test overrides it for itself only
    c8y.user(null)

    const { res } = await fetchJson('/user')

    // The platform answers 401; @c8y/client throws { res, data } and the
    // c8y-client middleware turns upstream errors into a 500.
    expect(res.status).toBe(500)
    expect(c8y).toHaveReceived('GET /user/currentUser')
  })

  it('restores the file-level user after a test override', async () => {
    expect((await fetchJson('/user')).json.userName).toBe('testUser')
  })
})

describe('role middleware', () => {
  describe('without the required roles', () => {
    // describe level: applies to the tests of this describe
    c8y.user({ userName: 'someUser', roles: ['SOME_CUSTOM_ROLE'] })

    it('denies access', async () => {
      const { res, json } = await fetchJson('/protectedRoute')

      expect(res.status).toBe(403)
      expect(json.message).toBe('User does not have required role(s) to access this resource: ADMIN_ROLE')
    })

    it('denies access when the user has none of the required roles', async () => {
      const { res, json } = await fetchJson('/protected-multi-role')

      expect(res.status).toBe(403)
      expect(json.message).toContain('ROLE_A')
      expect(json.message).toContain('ROLE_B')
    })
  })

  describe('with the required roles', () => {
    c8y.user({ userName: 'adminUser', roles: ['ADMIN_ROLE', 'ROLE_B'] })

    it('allows access', async () => {
      const { res, json } = await fetchJson('/protectedRoute')

      expect(res.status).toBe(200)
      expect(json.message).toBe('You have access to the protected route!')
    })

    it('allows access when the user has one of the required roles', async () => {
      const { res, json } = await fetchJson('/protected-multi-role')

      expect(res.status).toBe(200)
      expect(json.message).toBe('You have one of the required roles!')
    })

    it('can send a single request as another user', async () => {
      const { res } = await fetchJson('/protectedRoute', { as: { roles: [] } })
      expect(res.status).toBe(403)

      // the describe's user is back for the next request
      expect((await fetchJson('/protectedRoute')).res.status).toBe(200)
    })
  })
})

describe('tenant middleware', () => {
  it('allows access for an allowed tenant', async () => {
    const { res, json } = await fetchJson('/tenant-restricted')

    expect(res.status).toBe(200)
    expect(json.message).toBe('Your tenant is allowed!')
  })

  it('denies access for a disallowed tenant', async () => {
    c8y.user({ userName: 'testUser', roles: [], tenant: 't00000' })

    const { res, json } = await fetchJson('/tenant-restricted')

    expect(res.status).toBe(403)
    expect(json.message).toContain('t00000')
    expect(json.message).toContain('not allowed')
  })

  it('allows access for a deployed tenant user', async () => {
    const { res, json } = await fetchJson('/deployed-tenant-only')

    expect(res.status).toBe(200)
    expect(json.message).toBe('You are from the deployed tenant!')
  })

  it('denies access for a user from another tenant', async () => {
    const { res, json } = await fetchJson('/deployed-tenant-only', { as: { tenant: 't99999' } })

    expect(res.status).toBe(403)
    expect(json.message).toContain(c8y.tenant)
  })
})
