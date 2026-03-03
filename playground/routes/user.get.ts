import { defineEventHandler } from 'nitro/h3'
import { useUserClient } from 'c8y-nitro/utils'
import { useLogger } from 'evlog'

export default defineEventHandler(async (event) => {
  const client = useUserClient(event)
  const log = useLogger(event)
  const res = await client.user.current()
  const user = res.data
  log.set({ action: 'get-user', user: { user: user.userName } })
  return user
})
