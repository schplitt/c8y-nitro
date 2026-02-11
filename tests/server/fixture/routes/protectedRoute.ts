import { defineHandler } from 'nitro/h3'
import { hasUserRequiredRole } from 'c8y-nitro/utils'

export default defineHandler({
  middleware: [hasUserRequiredRole('ADMIN_ROLE')],
  handler: async () => {
    return { message: 'You have access to the protected route!' }
  },
})
