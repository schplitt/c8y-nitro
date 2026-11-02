import { afterEach, describe, expect, it, vi } from 'vitest'
import { c8yMock } from './mocks/c8y-client'
import { fetchJson, stubC8yEnv } from './utils'

stubC8yEnv()

vi.mock('@c8y/client', async () => {
  const { mockC8yClientModule } = await import('./mocks/c8y-client')
  return mockC8yClientModule()
})

afterEach(() => {
  // reset per-test changes to the dev tenant and the current user
  stubC8yEnv()
  c8yMock.currentUser = null
})

function setUser(userName: string, roles: string[]) {
  c8yMock.currentUser = { userName, effectiveRoles: roles.map((name) => ({ name })) } as typeof c8yMock.currentUser
}

describe('user resources', () => {
  it('returns the current user and their roles', async () => {
    setUser('testUser', ['ROLE_INVENTORY_READ', 'ROLE_ALARM_READ', 'ROLE_DEVICE_CONTROL'])

    const { res, json } = await fetchJson('/user')

    expect(res.status).toBe(200)
    expect(json.userName).toBe('testUser')
    expect(json.roles).toEqual(['ROLE_INVENTORY_READ', 'ROLE_ALARM_READ', 'ROLE_DEVICE_CONTROL'])
  })
})

describe('role middleware', () => {
  it('denies access without the required role', async () => {
    setUser('someUser', ['SOME_CUSTOM_ROLE'])

    const { res, json } = await fetchJson('/protectedRoute')

    expect(res.status).toBe(403)
    expect(json.message).toBe('User does not have required role(s) to access this resource: ADMIN_ROLE')
  })

  it('denies access when the user has none of the required roles', async () => {
    setUser('someUser', ['SOME_CUSTOM_ROLE'])

    const { res, json } = await fetchJson('/protected-multi-role')

    expect(res.status).toBe(403)
    expect(json.message).toContain('ROLE_A')
    expect(json.message).toContain('ROLE_B')
  })

  it('allows access with the required role', async () => {
    setUser('adminUser', ['ADMIN_ROLE', 'ROLE_B'])

    const { res, json } = await fetchJson('/protectedRoute')

    expect(res.status).toBe(200)
    expect(json.message).toBe('You have access to the protected route!')
  })

  it('allows access when the user has one of the required roles', async () => {
    setUser('adminUser', ['ADMIN_ROLE', 'ROLE_B'])

    const { res, json } = await fetchJson('/protected-multi-role')

    expect(res.status).toBe(200)
    expect(json.message).toBe('You have one of the required roles!')
  })
})

describe('tenant middleware', () => {
  it('allows access for an allowed tenant', async () => {
    setUser('testUser', [])

    const { res, json } = await fetchJson('/tenant-restricted')

    expect(res.status).toBe(200)
    expect(json.message).toBe('Your tenant is allowed!')
  })

  it('denies access for a disallowed tenant', async () => {
    setUser('testUser', [])
    vi.stubEnv('C8Y_DEVELOPMENT_TENANT', 't00000')

    const { res, json } = await fetchJson('/tenant-restricted')

    expect(res.status).toBe(403)
    expect(json.message).toContain('t00000')
    expect(json.message).toContain('not allowed')
  })

  it('allows access for a deployed tenant user', async () => {
    setUser('testUser', [])

    const { res, json } = await fetchJson('/deployed-tenant-only')

    expect(res.status).toBe(200)
    expect(json.message).toBe('You are from the deployed tenant!')
  })

  it('denies access for a user from another tenant', async () => {
    setUser('testUser', [])
    vi.stubEnv('C8Y_DEVELOPMENT_TENANT', 't99999')

    const { res, json } = await fetchJson('/deployed-tenant-only')

    expect(res.status).toBe(403)
    expect(json.message).toContain('t12345')
  })
})
