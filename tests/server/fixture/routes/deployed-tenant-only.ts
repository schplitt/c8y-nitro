import { defineHandler } from 'nitro/h3'
import { isUserFromDeployedTenant } from 'c8y-nitro/utils'

export default defineHandler({
  middleware: [isUserFromDeployedTenant()],
  handler: async () => {
    return { message: 'You are from the deployed tenant!' }
  },
})
