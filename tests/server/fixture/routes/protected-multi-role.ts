import { defineHandler } from 'nitro/h3'
import { hasUserRequiredRole } from 'c8y-nitro/utils'

export default defineHandler({
  middleware: [hasUserRequiredRole(['ROLE_A', 'ROLE_B'])],
  handler: async () => {
    return { message: 'You have one of the required roles!' }
  },
})
