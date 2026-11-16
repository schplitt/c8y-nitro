import { defineEventHandler, readBody } from 'nitro/h3'
import { useTenantRealtimeClient } from 'c8y-nitro/utils'

// Listens to alarms of a subscribed tenant, lazily: the realtime client is
// created after startup, on the first call of this route.
export default defineEventHandler(async (event) => {
  const { tenant } = await readBody<{ tenant: string }>(event) ?? {} as never
  const realtime = await useTenantRealtimeClient(tenant)
  realtime.alarms.onCreate('*', () => {})
  return { listening: tenant }
})
