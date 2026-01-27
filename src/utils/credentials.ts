import { Client } from '@c8y/client'
import type { ICredentials } from '@c8y/client'
import { defineCachedFunction } from 'nitro/cache'
import { useRequest } from 'nitro/context'
import { HTTPError } from 'nitro/h3'
import { useStorage } from 'nitro/storage'
import process from 'node:process'
import { useUserClient } from './client'

/**
 * Fetches credentials for all tenants subscribed to this microservice.\
 * Uses bootstrap credentials from runtime config to query the microservice subscriptions API.\
 * Results are cached for 10 minutes.\
 * @returns Object mapping tenant IDs to their respective credentials
 * @example
 * // Get all subscribed tenant credentials:
 * const credentials = await useSubscribedTenantCredentials()
 * console.log(Object.keys(credentials)) // ['t12345', 't67890']
 *
 * // Access specific tenant:
 * const tenant1Creds = credentials['t12345']
 *
 * // Invalidate cache:
 * await useSubscribedTenantCredentials.invalidate()
 *
 * // Force refresh:
 * const freshCreds = await useSubscribedTenantCredentials.refresh()
 */
export const useSubscribedTenantCredentials = Object.assign(
  defineCachedFunction(async () => {
    // all env vars are enforced to be set
    const subscriptions = await Client.getMicroserviceSubscriptions({
      tenant: process.env.C8Y_BOOTSTRAP_TENANT!,
      user: process.env.C8Y_BOOTSTRAP_USER!,
      password: process.env.C8Y_BOOTSTRAP_PASSWORD!,
    }, process.env.C8Y_BASEURL!)

    // we map them as an object with tenant as key for easier access
    return subscriptions.reduce(
      (acc, cred) => {
        if (cred.tenant) {
          acc[cred.tenant] = cred
        }
        return acc
      },
      {} as Record<string, ICredentials>,
    )
  }, {
    maxAge: 10 * 60, // 10 minutes
    name: '_c8y_nitro_get_subscribed_tenant_credentials',
    group: 'c8y_nitro',
    swr: false,
  }),
  {
    invalidate: async () => {
      const completeKey = `c8y_nitro:functions:_c8y_nitro_get_subscribed_tenant_credentials.json`
      await useStorage('cache').removeItem(completeKey)
    },
    refresh: async () => {
      // call the invalidate part
      await useSubscribedTenantCredentials.invalidate()
      // then call the function to refresh
      return await useSubscribedTenantCredentials()
    },
  },
)

/**
 * Fetches credentials for the tenant where this microservice is deployed.\
 * Uses the C8Y_BOOTSTRAP_TENANT environment variable to identify the deployed tenant.\
 * Returns credentials from the subscribed tenant credentials cache (cached for 10 minutes).
 * @returns Credentials for the deployed tenant
 * @throws {HTTPError} If no credentials found for the deployed tenant
 * @example
 * // Get deployed tenant credentials:
 * const creds = await useDeployedTenantCredentials()
 * console.log(creds.tenant, creds.user)
 *
 * // Invalidate cache:
 * await useDeployedTenantCredentials.invalidate()
 *
 * // Force refresh:
 * const freshCreds = await useDeployedTenantCredentials.refresh()
 * @note This function is not cached separately. It uses the cache of `useSubscribedTenantCredentials()`. Invalidating or refreshing one will refresh `useDeployedTenantCredentials()`s cache.
 */
export const useDeployedTenantCredentials = Object.assign(async (): Promise<ICredentials> => {
  const tenant = process.env.C8Y_BOOTSTRAP_TENANT!
  const allCredsPromise = await useSubscribedTenantCredentials()
  if (!allCredsPromise[tenant]) {
    throw new HTTPError({
      message: `No credentials found for tenant deployed tenant '${tenant}'`,
      status: 500,
      statusText: 'Internal Server Error',
    })
  }
  return allCredsPromise[tenant]
}, {
  invalidate: useSubscribedTenantCredentials.invalidate,
  refresh: async () => {
    // call the invalidate part
    await useDeployedTenantCredentials.invalidate()
    // then call the function to refresh
    return await useDeployedTenantCredentials()
  },
})

/**
 * Fetches credentials for the tenant of the current user making the request.\
 * Extracts the user's tenant ID from the request headers and returns corresponding credentials.\
 * Results are cached in the request context for subsequent calls within the same request.\
 * Must be called within a request handler context.
 * @returns Credentials for the user's tenant
 * @throws {HTTPError} If no subscribed tenant credentials found for the user's tenant
 * @example
 * // In a request handler:
 * const userCreds = await useUserTenantCredentials()
 * console.log(userCreds.tenant, userCreds.user)
 *
 * // Credentials are automatically cached for the request duration
 * const sameCreds = await useUserTenantCredentials() // Uses cached value
 */
export async function useUserTenantCredentials(): Promise<ICredentials> {
  const request = useRequest()

  // check if we have cached creds in request context
  if (request.context?.['c8y_user_tenant_credentials']) {
    return request.context['c8y_user_tenant_credentials'] as ICredentials
  }

  const userClient = useUserClient()

  const tenantId = userClient.core.tenant

  const creds = await useSubscribedTenantCredentials()
  const userTenantCreds = creds[tenantId]
  if (!userTenantCreds) {
    throw new HTTPError({
      message: `No subscribed tenant credentials found for user tenant '${tenantId}'`,
      status: 500,
      statusText: 'Internal Server Error',
    })
  }

  // cache creds in request context for subsequent calls
  request.context ??= {}
  request.context['c8y_user_tenant_credentials'] = userTenantCreds

  return userTenantCreds
}
