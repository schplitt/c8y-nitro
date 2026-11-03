import { defineHandler, getRouterParam } from 'nitro/h3'
import { hasUserRequiredRole, useUserTenantClient } from 'c8y-nitro/utils'
import { findPump, latestTemperature } from '../../../lib/pumps'

// GET /pumps/:serial — name and latest temperature of a pump
export default defineHandler({
  middleware: [hasUserRequiredRole('ROLE_INVENTORY_READ')],
  handler: async (event) => {
    const client = await useUserTenantClient(event)
    const pump = await findPump(client, getRouterParam(event, 'serial')!)

    return {
      name: pump.name,
      temperature: await latestTemperature(client, pump.id),
    }
  },
})
