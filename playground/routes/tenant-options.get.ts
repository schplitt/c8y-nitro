import { defineEventHandler } from 'nitro/h3'
import { useDeployedTenantClient, useTenantOption, useTenantOptions } from 'c8y-nitro/utils'

export default defineEventHandler(async () => {
  const client = await useDeployedTenantClient()

  const myOption = await useTenantOption(client, 'myOption').read()
  const secret = await useTenantOption(client, 'credentials.secret').read()
  const all = await useTenantOptions(client).list()

  return {
    myOption,
    secret,
    all,
    message: 'Fetched tenant options successfully',
  }
})
