import { defineEventHandler } from 'nitro/h3'
import { c8yRoles } from 'c8y-nitro/runtime'

export default defineEventHandler(() => {
  return `Available roles: ${Object.values(c8yRoles).join(', ')}`
})
