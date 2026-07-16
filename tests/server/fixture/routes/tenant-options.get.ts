import { defineEventHandler } from 'nitro/h3'
import { useDeployedTenantClient, useTenantOption } from 'c8y-nitro/utils'

export default defineEventHandler(async () => {
  const client = await useDeployedTenantClient()
  const myOption = await useTenantOption(client, 'myOption').read()
  const secret = await useTenantOption(client, 'credentials.secret').read()
  const cacheExpiryOption = await useTenantOption(client, 'cacheExpiryOption').read()

  return {
    myOption,
    'credentials.secret': secret,
    cacheExpiryOption,
    'message': 'Fetched tenant options successfully',
  }
})
