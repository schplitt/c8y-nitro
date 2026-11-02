import { defineHandler, getRouterParam } from 'nitro/h3'
import { hasUserRequiredRole, useTenantOption, useUserTenantClient } from 'c8y-nitro/utils'
import { findPump, latestTemperature } from '../../../lib/pumps'

// POST /pumps/:serial/check — raises an overheating alarm above the configured maximum
export default defineHandler({
  middleware: [hasUserRequiredRole('ROLE_ALARM_ADMIN')],
  handler: async (event) => {
    const client = await useUserTenantClient(event)
    const pump = await findPump(client, getRouterParam(event, 'serial')!)
    const temperature = await latestTemperature(client, pump.id)
    const maxTemperature = Number(await useTenantOption(client, 'maxTemperature').read() ?? 80)

    const overheating = temperature !== null && temperature > maxTemperature
    if (overheating) {
      await client.alarm.create({
        source: { id: pump.id },
        type: 'pump_Overheating',
        text: `Pump is at ${temperature} °C (maximum ${maxTemperature} °C)`,
        severity: 'CRITICAL',
        time: new Date().toISOString(),
      } as any)
    }

    return { temperature, maxTemperature, overheating }
  },
})
