import { defineEventHandler, getQuery } from 'nitro/h3'
import { useDeployedTenantClient } from 'c8y-nitro/utils'

// Lists devices whose name starts with ?prefix, sorted by name.
export default defineEventHandler(async (event) => {
  const client = await useDeployedTenantClient()
  const prefix = String(getQuery(event).prefix ?? '')
  const { data } = await client.inventory.list({
    query: `$filter=(has(c8y_IsDevice) and name eq '${prefix}*') $orderby=name asc`,
    pageSize: 100,
  })

  return { names: data.map((device) => device.name) }
})
