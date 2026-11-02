import { defineEventHandler, getRouterParam } from 'nitro/h3'
import { useDeployedTenantClient } from 'c8y-nitro/utils'

// Returns the text content of an inventory binary.
export default defineEventHandler(async (event) => {
  const client = await useDeployedTenantClient()
  const res = await client.inventoryBinary.download(getRouterParam(event, 'id')!) as unknown as Response

  return { content: await res.text() }
})
