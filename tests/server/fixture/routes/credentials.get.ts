import { defineEventHandler } from 'nitro/h3'
import { useSubscribedTenantCredentials, useDeployedTenantCredentials, useUserTenantCredentials } from 'c8y-nitro/utils'

export default defineEventHandler(async (event) => {
  const allCredentials = await useSubscribedTenantCredentials()
  const deployedCredentials = await useDeployedTenantCredentials()
  const userTenantCredentials = await useUserTenantCredentials(event)

  return {
    subscribedTenants: Object.keys(allCredentials),
    deployedTenant: deployedCredentials.tenant,
    userTenant: userTenantCredentials.tenant,
  }
})
