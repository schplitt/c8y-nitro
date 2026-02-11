import { defineHandler } from 'nitro/h3'
import { isUserFromAllowedTenant } from 'c8y-nitro/utils'

export default defineHandler({
  middleware: [isUserFromAllowedTenant(['t12345', 't99999'])],
  handler: async () => {
    return { message: 'Your tenant is allowed!' }
  },
})
