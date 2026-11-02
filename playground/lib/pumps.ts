import type { Client } from '@c8y/client'
import { createError } from 'c8y-nitro/utils'

/**
 * Finds a pump by its serial number (external id `c8y_Serial`), or throws a 404.
 * @param client
 * @param serial
 */
export async function findPump(client: Client, serial: string) {
  try {
    const { data: externalId } = await client.identity.detail({ type: 'c8y_Serial', externalId: serial } as any)
    const { data: pump } = await client.inventory.detail(externalId.managedObject!.id!)
    return pump
  } catch (error) {
    if ((error as { res?: { status?: number } }).res?.status === 404) {
      throw createError({ status: 404, message: `Pump ${serial} not found` })
    }
    throw error
  }
}

/**
 * The latest temperature of a pump, or `null`.
 * @param client
 * @param pumpId
 */
export async function latestTemperature(client: Client, pumpId: string): Promise<number | null> {
  const { data } = await client.measurement.list({
    source: pumpId,
    type: 'c8y_Temperature',
    dateFrom: '1970-01-01T00:00:00Z',
    revert: true,
    pageSize: 1,
  })
  return (data[0] as { c8y_Temperature?: { T?: { value?: number } } } | undefined)?.c8y_Temperature?.T?.value ?? null
}
