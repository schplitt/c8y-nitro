import { BasicAuth, Client } from '@c8y/client'
import { useRequest } from 'nitro/context'
import { useRuntimeConfig } from 'nitro/runtime-config'
import { extractUserCredentialsFromHeaders } from './common'
import { getSubscribedTenantCredentials } from './cached'
import { HTTPError } from 'nitro/deps/h3'

/**
 * Creates a Cumulocity client authenticated with the current user's credentials.\
 * Extracts credentials from the Authorization header of the current request.\
 * Must be called within a request handler context.\
 * @returns A configured Cumulocity Client instance
 * @example
 * // In a request handler:
 * const client = getUserClient()
 * const { data } = await client.inventory.list()
 */
export function getUserClient(): Client {
  const creds = extractUserCredentialsFromHeaders(useRequest())
  // C8Y_BASE_URL is enforced to be set
  return new Client(new BasicAuth(creds), useRuntimeConfig().C8Y_BASE_URL)
}

/**
 * Creates Cumulocity clients for all tenants subscribed to this microservice.\
 * Each client is authenticated with that tenant's service user credentials.\
 * @returns Object mapping tenant IDs to their respective Client instances
 * @example
 * // Get clients for all subscribed tenants:
 * const clients = await getSubscribedTenantClients()
 * for (const [tenant, client] of Object.entries(clients)) {
 *   const { data } = await client.inventory.list()
 *   console.log(`Tenant ${tenant} has ${data.length} inventory items`)
 * }
 */
export async function getSubscribedTenantClients(): Promise<Record<string, Client>> {
  const creds = await getSubscribedTenantCredentials()
  const clients: Record<string, Client> = {}
  for (const [tenant, tenantCreds] of Object.entries(creds)) {
    clients[tenant] = new Client(new BasicAuth(tenantCreds), useRuntimeConfig().C8Y_BASE_URL)
  }
  return clients
}

/**
 * Creates a Cumulocity client for the tenant where this microservice is deployed.\
 * Uses the bootstrap tenant ID from runtime config to identify the deployed tenant.\
 * @returns A configured Cumulocity Client instance for the deployed tenant
 * @example
 * // Get client for the tenant hosting this microservice:
 * const client = await getDeployedTenantClient()
 * const { data } = await client.application.list()
 */
export async function getDeployedTenantClient(): Promise<Client> {
  const creds = await getSubscribedTenantCredentials()
  // C8Y_BOOTSTRAP_TENANT is enforced to be set
  const tenant = useRuntimeConfig().C8Y_BOOTSTRAP_TENANT
  if (!creds[tenant]) {
    throw new HTTPError({
      message: `No subscribed tenant credentials found for tenant '${tenant}'`,
      status: 500,
      statusText: 'Internal Server Error',
    })
  }
  return new Client(new BasicAuth(creds[tenant]), useRuntimeConfig().C8Y_BASE_URL)
}
