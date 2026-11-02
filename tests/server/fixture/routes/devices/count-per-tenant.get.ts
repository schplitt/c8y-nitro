import { defineEventHandler } from 'nitro/h3'
import { useSubscribedTenantClients } from 'c8y-nitro/utils'

// A multi-tenant job: counts the devices of every subscribed tenant.
export default defineEventHandler(async () => {
  const clients = await useSubscribedTenantClients()
  const counts: Record<string, number> = {}
  for (const [tenant, client] of Object.entries(clients)) {
    const { data } = await client.inventory.list({ fragmentType: 'c8y_IsDevice', pageSize: 100 })
    counts[tenant] = data.length
  }
  return counts
})
