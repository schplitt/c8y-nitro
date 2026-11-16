import { defineEventHandler, readBody } from 'nitro/h3'
import { useSubscribedTenantClients } from 'c8y-nitro/utils'

// Sends a platform request as the service user of a subscribed tenant and
// reports the answer, or the error the request failed with.
export default defineEventHandler(async (event) => {
  const { tenant, method, path, body } = await readBody<{ tenant: string, method: string, path: string, body?: unknown }>(event) ?? {} as never
  const client = (await useSubscribedTenantClients())[tenant]!
  try {
    const res = await client.core.fetch(path, {
      method,
      headers: { 'content-type': 'application/json', 'accept': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: res.status }
  } catch (error) {
    return { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
  }
})
