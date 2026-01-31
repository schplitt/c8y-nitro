import { defineEventHandler } from 'nitro/h3'
import { useUserClient } from 'c8y-nitro/utils'

export default defineEventHandler(async (event) => {
  const client = useUserClient(event)
  const res = await client.user.current()
  const user = res.data
  return user
})
