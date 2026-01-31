import { defineEventHandler } from 'nitro/h3'
import { useUserClient } from 'c8y-nitro/utils'
import { c8yConfig } from 'c8y-nitro/runtime'

export default defineEventHandler(async (event) => {
  console.log('Credentials TTL (ms):', c8yConfig.cache.credentialsTTL)

  const client = useUserClient(event)
  const res = await client.user.current()
  const user = res.data
  return user
})
