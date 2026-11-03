import { defineEventHandler, getRouterParam } from 'nitro/h3'
import { useDeployedTenantClient } from 'c8y-nitro/utils'

// Calls an arbitrary platform API (inventory) through the real @c8y/client.
export default defineEventHandler(async (event) => {
  const client = await useDeployedTenantClient()
  const { data } = await client.inventory.detail(getRouterParam(event, 'id')!)

  return { id: data.id, name: data.name }
})
