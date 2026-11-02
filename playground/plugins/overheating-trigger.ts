import process from 'node:process'
import { definePlugin } from 'nitro'
import { useDeployedTenantClient, useTenantOption, useTenantRealtimeClient } from 'c8y-nitro/utils'

// Realtime trigger: raises an alarm as soon as a pump reports a temperature
// above the configured maximum (tenant option `maxTemperature`, default 80).
export default definePlugin(async () => {
  const realtime = await useTenantRealtimeClient(process.env.C8Y_BOOTSTRAP_TENANT!)

  realtime.measurements.onCreate('*', async (measurement: any) => {
    const temperature = measurement.c8y_Temperature?.T?.value
    if (typeof temperature !== 'number') {
      return
    }
    const client = await useDeployedTenantClient()
    const maxTemperature = Number(await useTenantOption(client, 'maxTemperature').read() ?? 80)
    if (temperature > maxTemperature) {
      await client.alarm.create({
        source: { id: measurement.source.id },
        type: 'pump_Overheating',
        text: `Pump is at ${temperature} °C (maximum ${maxTemperature} °C)`,
        severity: 'CRITICAL',
        time: measurement.time,
      } as any)
    }
  })
})
