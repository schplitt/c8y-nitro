import { Client } from '@c8y/client'
import type { ICredentials } from '@c8y/client'
import { defineCachedFunction } from 'nitro/cache'
import { useStorage } from 'nitro/storage'
import process from 'node:process'

/**
 * Fetches credentials for all tenants subscribed to this microservice.\
 * Uses bootstrap credentials from runtime config to query the microservice subscriptions API.\
 * Results are cached for 10 minutes.\
 * @returns Object mapping tenant IDs to their respective credentials
 * @example
 * // Get all subscribed tenant credentials:
 * const credentials = await getSubscribedTenantCredentials()
 * console.log(Object.keys(credentials)) // ['t12345', 't67890']
 *
 * // Access specific tenant:
 * const tenant1Creds = credentials['t12345']
 *
 * // Invalidate cache:
 * await getSubscribedTenantCredentials.invalidate()
 *
 * // Force refresh:
 * const freshCreds = await getSubscribedTenantCredentials.refresh()
 */
export const getSubscribedTenantCredentials = Object.assign(
  defineCachedFunction(async () => {
    // all env vars are enforced to be set
    const subscriptions = await Client.getMicroserviceSubscriptions({
      tenant: process.env.C8Y_BOOTSTRAP_TENANT!,
      user: process.env.C8Y_BOOTSTRAP_USER!,
      password: process.env.C8Y_BOOTSTRAP_PASSWORD!,
    }, process.env.C8Y_BASE_URL!)

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
      await getSubscribedTenantCredentials.invalidate()
      // then call the function to refresh
      return await getSubscribedTenantCredentials()
    },
  },
)
