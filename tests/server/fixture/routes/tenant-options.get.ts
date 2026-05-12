import { defineEventHandler } from 'nitro/h3'
import { useTenantOption } from 'c8y-nitro/utils'

export default defineEventHandler(async () => {
  const myOption = await useTenantOption('myOption')
  const secret = await useTenantOption('credentials.secret')
  const cacheExpiryOption = await useTenantOption('cacheExpiryOption')

  return {
    myOption,
    'credentials.secret': secret,
    cacheExpiryOption,
    'message': 'Fetched tenant options successfully',
  }
})
