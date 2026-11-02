import { useSubscribedTenantCredentials } from 'c8y-nitro/utils'
import { defineEventHandler, getQuery } from 'nitro/h3'

export default defineEventHandler(async (event) => {
  const credentials = getQuery(event).refresh === '1'
    ? await useSubscribedTenantCredentials.refresh()
    : await useSubscribedTenantCredentials()

  return {
    subscribedTenants: Object.keys(credentials).sort(),
  }
})
