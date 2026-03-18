import { defineEventHandler } from 'nitro/h3'
import { c8yRoles, c8yManifest } from 'c8y-nitro/runtime'

export default defineEventHandler(() => {
  // eslint-disable-next-line no-console
  console.log(c8yRoles)
  return {
    roles: c8yRoles,
    manifest: c8yManifest,
  }
})
