import { defineEventHandler, getRouterParam } from 'nitro/h3'
import { useDeployedTenantClient } from 'c8y-nitro/utils'

// Looks up a device by its serial number (external id).
export default defineEventHandler(async (event) => {
  const client = await useDeployedTenantClient()
  const { data: externalId } = await client.identity.detail({ type: 'c8y_Serial', externalId: getRouterParam(event, 'serial')! })
  const { data: device } = await client.inventory.detail(externalId.managedObject!.id!)

  return { id: device.id, name: device.name }
})
