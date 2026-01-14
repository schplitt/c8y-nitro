import { defineEventHandler } from 'nitro/h3'
import { c8yRoles } from 'c8y-nitro/runtime'

export default defineEventHandler({
  middleware: [],
  handler: async () => {
    const test = c8yRoles.ANOTHER_ROLE
    return `Test ${test}`
  },
})
