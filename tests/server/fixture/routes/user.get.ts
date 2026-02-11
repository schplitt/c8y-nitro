import { defineEventHandler } from 'nitro/h3'
import { useUser, useUserRoles } from 'c8y-nitro/utils'

export default defineEventHandler(async (event) => {
  const user = await useUser(event)
  const roles = await useUserRoles(event)

  return {
    userName: user.userName,
    roles,
  }
})
