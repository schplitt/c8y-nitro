import { defineEventHandler, getRouterParam } from 'nitro/h3'
import { useDeployedTenantClient } from 'c8y-nitro/utils'

// Requests a restart operation for a device.
export default defineEventHandler(async (event) => {
  const client = await useDeployedTenantClient()
  const { data } = await client.operation.create({
    deviceId: getRouterParam(event, 'id')!,
    description: 'Restart',
    c8y_Restart: {},
  } as any)

  return { operationId: data.id, status: data.status }
})
