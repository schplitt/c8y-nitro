import { defineEventHandler } from 'nitro/h3'
import { useTenantOption } from 'c8y-nitro/utils'

export default defineEventHandler(async () => {
  const myOption = await useTenantOption('myOption')
  const secret = await useTenantOption('credentials.secret')

  return {
    myOption,
    secret,
    message: 'Fetched tenant options successfully',
  }
})
