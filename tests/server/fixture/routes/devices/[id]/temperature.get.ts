import { defineEventHandler, getRouterParam } from 'nitro/h3'
import { useDeployedTenantClient } from 'c8y-nitro/utils'

// Latest temperature of a device.
export default defineEventHandler(async (event) => {
  const client = await useDeployedTenantClient()
  const { data } = await client.measurement.list({
    source: getRouterParam(event, 'id')!,
    type: 'c8y_Temperature',
    dateFrom: '1970-01-01T00:00:00Z',
    revert: true,
    pageSize: 1,
  })

  return { temperature: (data[0] as any)?.c8y_Temperature?.T?.value ?? null }
})
