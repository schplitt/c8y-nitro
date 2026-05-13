import * as c8yClient from '@c8y/client'
import type { ICredentials } from '@c8y/client'
import { useSubscribedTenantCredentials } from 'c8y-nitro/utils'
import { defineEventHandler, getQuery } from 'nitro/h3'

const mockSubscriptionApi = c8yClient as unknown as {
  __setMockSubscription: (subscription: ICredentials) => void
  __getMockSubscriptions: () => Array<ICredentials>
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const tenant = typeof query.tenant === 'string' ? query.tenant : undefined
  const user = typeof query.user === 'string' ? query.user : undefined
  const password = typeof query.password === 'string' ? query.password : undefined

  if (tenant && user && password) {
    mockSubscriptionApi.__setMockSubscription({ tenant, user, password })
  }

  const credentials = query.refresh === '1'
    ? await useSubscribedTenantCredentials.refresh()
    : await useSubscribedTenantCredentials()

  return {
    subscribedTenants: Object.keys(credentials).sort(),
    mockSubscribedTenants: mockSubscriptionApi.__getMockSubscriptions()
      .map((subscription) => subscription.tenant)
      .filter((subscriptionTenant): subscriptionTenant is string => Boolean(subscriptionTenant))
      .sort(),
  }
})
