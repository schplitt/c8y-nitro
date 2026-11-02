import process from 'node:process'
import { definePlugin } from 'nitro'
import { useDeployedTenantClient, useTenantRealtimeClient } from 'c8y-nitro/utils'

// A realtime trigger: raises an alarm when a device reports more than 80 °C.
export default definePlugin(async () => {
  const realtime = await useTenantRealtimeClient(process.env.C8Y_BOOTSTRAP_TENANT!)

  realtime.measurements.onCreate('*', async (measurement: any) => {
    const value = measurement.c8y_Temperature?.T?.value
    if (typeof value !== 'number' || value <= 80) {
      return
    }
    const client = await useDeployedTenantClient()
    await client.alarm.create({
      source: { id: measurement.source.id },
      type: 'c8y_Overheating',
      text: `Temperature ${value} °C`,
      severity: 'CRITICAL',
      time: measurement.time,
    } as any)
  })
})
