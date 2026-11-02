import { describe, expect, it, vi } from 'vitest'
import { c8yMock } from './mocks/c8y-client'
import { clearCredentialHookEvents, getCredentialHookEvents } from './fixture/plugins/tenant-credentials-updated'
import { fetchJson, stubC8yEnv } from './utils'

stubC8yEnv()

vi.mock('@c8y/client', async () => {
  const { mockC8yClientModule } = await import('./mocks/c8y-client')
  return mockC8yClientModule({
    currentUser: { userName: 'testUser', effectiveRoles: [] } as any,
    subscriptions: [
      { tenant: 't12345', user: 'serviceuser1', password: 'pass1' },
      { tenant: 't67890', user: 'serviceuser2', password: 'pass2' },
    ],
  })
})

describe('tenant credentials', () => {
  it('returns subscribed tenants and deployed tenant credentials', async () => {
    const { res, json } = await fetchJson('/credentials')

    expect(res.status).toBe(200)
    expect(json.subscribedTenants).toEqual(expect.arrayContaining(['t12345', 't67890']))
    expect(json.deployedTenant).toBe('t12345')
    expect(json.userTenant).toBe('t12345')
  })

  it('only emits the lifecycle hook when the tenant id set changes', async () => {
    const subscribedTenants = async (refresh = false) =>
      (await fetchJson(`/subscribed-credentials${refresh ? '?refresh=1' : ''}`)).json.subscribedTenants
    const takeEvents = () => {
      const events = getCredentialHookEvents()
      clearCredentialHookEvents()
      return events
    }

    expect(await subscribedTenants()).toEqual(['t12345', 't67890'])
    takeEvents()

    // unchanged refresh → no event
    expect(await subscribedTenants(true)).toEqual(['t12345', 't67890'])
    expect(takeEvents()).toEqual([])

    // added tenant: cached until refreshed, then exactly one event
    c8yMock.setSubscription({ tenant: 't99999', user: 'serviceuser3', password: 'pass3' })
    expect(await subscribedTenants()).toEqual(['t12345', 't67890'])
    expect(await subscribedTenants(true)).toEqual(['t12345', 't67890', 't99999'])
    expect(takeEvents()).toEqual([
      { prevTenants: ['t12345', 't67890'], nextTenants: ['t12345', 't67890', 't99999'] },
    ])

    // removed tenant
    c8yMock.deleteSubscription('t67890')
    expect(await subscribedTenants()).toEqual(['t12345', 't67890', 't99999'])
    expect(await subscribedTenants(true)).toEqual(['t12345', 't99999'])
    expect(takeEvents()).toEqual([
      { prevTenants: ['t12345', 't67890', 't99999'], nextTenants: ['t12345', 't99999'] },
    ])

    // replaced tenant (same count, different ids)
    c8yMock.deleteSubscription('t12345')
    c8yMock.setSubscription({ tenant: 't67890', user: 'serviceuser2', password: 'pass2' })
    expect(await subscribedTenants(true)).toEqual(['t67890', 't99999'])
    expect(takeEvents()).toEqual([
      { prevTenants: ['t12345', 't99999'], nextTenants: ['t67890', 't99999'] },
    ])
  })
})
