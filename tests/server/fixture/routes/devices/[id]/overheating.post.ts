import { defineEventHandler, getRouterParam } from 'nitro/h3'
import { useDeployedTenantClient } from 'c8y-nitro/utils'

// Raises an overheating alarm for a device.
export default defineEventHandler(async (event) => {
  const client = await useDeployedTenantClient()
  const { data } = await client.alarm.create({
    source: { id: getRouterParam(event, 'id')! },
    type: 'c8y_Overheating',
    text: 'Device is overheating',
    severity: 'CRITICAL' as any,
    time: new Date().toISOString(),
  })

  return { alarmId: data.id, count: data.count }
})
