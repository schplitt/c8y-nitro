import { BasicAuth, Client, MicroserviceClientRequestAuth } from '@c8y/client'
import { convertRequestHeadersToC8yFormat } from './internal/common'
import { useSubscribedTenantCredentials } from './credentials'
import type { H3Event } from 'nitro/h3'
import { HTTPError } from 'nitro/h3'
import process from 'node:process'
import type { ServerRequest } from 'nitro/types'

/**
 * Creates a Cumulocity client authenticated with the current user's credentials.\
 * Extracts credentials from the Authorization header of the current request.
 * @param requestOrEvent - The H3Event or ServerRequest from the current request
 * @returns A configured Cumulocity Client instance
 * @example
 * // In a request handler:
 * const client = useUserClient(event)
 * const { data } = await client.inventory.list()
 */
export function useUserClient(requestOrEvent: ServerRequest | H3Event): Client {
  const request = 'req' in requestOrEvent ? requestOrEvent.req : requestOrEvent

  if (request.context?.['c8y_user_client']) {
    return request.context['c8y_user_client'] as Client
  }

  const headers = convertRequestHeadersToC8yFormat(request)
  const auth = new MicroserviceClientRequestAuth(headers)

  // C8Y_BASEURL is enforced to be set
  const client = new Client(auth, process.env.C8Y_BASEURL)

  // cache client in request context for subsequent calls
  request.context ??= {}
  request.context['c8y_user_client'] = client

  return client
}

/**
 * Creates a Cumulocity client for the tenant of the current user.\
 * Uses the tenant's service user credentials rather than the user's own credentials.
 * @param requestOrEvent - The H3Event or ServerRequest from the current request
 * @returns A configured Cumulocity Client instance for the user's tenant
 * @example
 * // In a request handler:
 * const tenantClient = await useUserTenantClient(event)
 * const { data } = await tenantClient.inventory.list()
 */
export async function useUserTenantClient(requestOrEvent: ServerRequest | H3Event): Promise<Client> {
  const request = 'req' in requestOrEvent ? requestOrEvent.req : requestOrEvent

  if (request.context?.['c8y_user_tenant_client']) {
    return request.context['c8y_user_tenant_client'] as Client
  }

  const userClient = useUserClient(requestOrEvent)
  const tenantId = userClient.core.tenant

  const creds = await useSubscribedTenantCredentials()
  if (!creds[tenantId]) {
    throw new HTTPError({
      message: `No subscribed tenant credentials found for user tenant '${tenantId}'`,
      status: 500,
      statusText: 'Internal Server Error',
    })
  }
  const tenantClient = new Client(new BasicAuth(creds[tenantId]), process.env.C8Y_BASEURL)

  // cache client in request context for subsequent calls
  request.context ??= {}
  request.context['c8y_user_tenant_client'] = tenantClient

  return tenantClient
}

/**
 * Creates Cumulocity clients for all tenants subscribed to this microservice.\
 * Each client is authenticated with that tenant's service user credentials.\
 * @returns Object mapping tenant IDs to their respective Client instances
 * @example
 * // Get clients for all subscribed tenants:
 * const clients = await useSubscribedTenantClients()
 * for (const [tenant, client] of Object.entries(clients)) {
 *   const { data } = await client.inventory.list()
 *   console.log(`Tenant ${tenant} has ${data.length} inventory items`)
 * }
 */
export async function useSubscribedTenantClients(): Promise<Record<string, Client>> {
  const creds = await useSubscribedTenantCredentials()
  const clients: Record<string, Client> = {}
  for (const [tenant, tenantCreds] of Object.entries(creds)) {
    clients[tenant] = new Client(new BasicAuth(tenantCreds), process.env.C8Y_BASEURL)
  }
  return clients
}

/**
 * Creates a Cumulocity client for the tenant where this microservice is deployed.\
 * Uses the bootstrap tenant ID from runtime config to identify the deployed tenant.\
 * @returns A configured Cumulocity Client instance for the deployed tenant
 * @example
 * // Get client for the tenant hosting this microservice:
 * const client = await useDeployedTenantClient()
 * const { data } = await client.application.list()
 */
export async function useDeployedTenantClient(): Promise<Client> {
  const creds = await useSubscribedTenantCredentials()
  // C8Y_BOOTSTRAP_TENANT is enforced to be set
  const tenant = process.env.C8Y_BOOTSTRAP_TENANT!
  if (!creds[tenant]) {
    throw new HTTPError({
      message: `No subscribed tenant credentials found for tenant '${tenant}'`,
      status: 500,
      statusText: 'Internal Server Error',
    })
  }
  return new Client(new BasicAuth(creds[tenant]), process.env.C8Y_BASEURL!)
}
