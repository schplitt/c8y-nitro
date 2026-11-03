import type { C8yRequest } from '../types'
import type { TenantData } from '../store'
import { documents, RESOURCES } from './data'
import { identity } from './identity'
import { eventBinaries, inventoryBinaries } from './binaries'
import { inventory } from './inventory'
import { notifications } from './notifications'

export { UnsupportedRequestError } from './http'

/**
 * Answers a request from the emulated platform APIs (inventory, identity,
 * measurements, events, alarms, operations).
 * @param call - The request
 * @param segments - Decoded path segments
 * @param data - Data of the request's tenant
 * @returns The response, or `undefined` if the endpoint is not emulated
 */
export async function platformApi(call: C8yRequest, segments: string[], data: TenantData): Promise<Response | undefined> {
  const [domain, resource] = segments
  if (domain === 'inventory' && resource === 'binaries') {
    return inventoryBinaries(call, segments, data)
  }
  if (domain === 'event' && resource === 'events' && segments[3] === 'binaries' && segments.length === 4) {
    return eventBinaries(call, segments[2]!, data)
  }
  if (domain === 'inventory' && resource === 'managedObjects') {
    return inventory(call, segments, data)
  }
  if (domain === 'identity') {
    return identity(call, segments, data)
  }
  if (domain === 'measurement' && resource === 'measurements') {
    return documents(call, segments, data, RESOURCES.measurement)
  }
  if (domain === 'event' && resource === 'events') {
    return documents(call, segments, data, RESOURCES.event)
  }
  if (domain === 'alarm' && resource === 'alarms') {
    return documents(call, segments, data, RESOURCES.alarm)
  }
  if (domain === 'notification2') {
    return notifications(call, segments, data)
  }
  if (domain === 'devicecontrol' && resource === 'operations') {
    return documents(call, segments, data, RESOURCES.devicecontrol)
  }
  return undefined
}
