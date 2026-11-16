import { defineEventHandler } from 'nitro/h3'
import { useDeployedTenantClient } from 'c8y-nitro/utils'

// Calls an endpoint the fake tenant does not emulate.
export default defineEventHandler(async () => {
  const client = await useDeployedTenantClient()
  const res = await client.core.fetch('/features')

  return { status: res.status, body: await res.json() }
})
