import { defineEventHandler } from 'nitro/h3'
import { useTenantOption, useTenantOptions, useUserTenantClient } from 'c8y-nitro/utils'

export default defineEventHandler(async (event) => {
  const client = await useUserTenantClient(event)

  await useTenantOption(client, 'time right now').delete()
  await useTenantOption(client, 'time.right.now').set(new Date().toISOString())

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
