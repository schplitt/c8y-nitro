import { defineEventHandler, getQuery } from 'nitro/h3'
import { useDeployedTenantClient, useTenantOption } from 'c8y-nitro/utils'

/**
 * Updates the `editable` flag of an option of the own category through the
 * single-option handle.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const key = String(query.key ?? 'myOption')
  const editable = query.editable !== 'false'
  const targetTenant = String(query.targetTenant)
  const client = await useDeployedTenantClient()

  const result = await useTenantOption(client, key).setEditable(editable, { targetTenant })

  return { key, editable, targetTenant, result: result ?? null }
})
