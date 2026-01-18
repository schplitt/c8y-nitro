import { useRequest } from 'nitro/context'
import { BasicAuth, Client } from '@c8y/client'
import type { ICredentials } from '@c8y/client'
import { useRuntimeConfig } from 'nitro/runtime-config'
import { defineCachedFunction } from 'nitro/cache'
import { useStorage } from 'nitro/storage'
import { HTTPError } from 'nitro/h3'
import { extractUserCredentialsFromHeaders } from './common'

/**
 * Fetches the current user from Cumulocity using credentials extracted from the current request's headers.\
 * Results are cached for 10 minutes per unique credentials.\
 * Must be called within a request handler context.\
 * @returns The current user object from Cumulocity
 * @example
 * // In a request handler:
 * const user = await getUser()
 * console.log(user.userName, user.email)
 *
 * // Invalidate cache:
 * await getUser.invalidate()
 *
 * // Force refresh:
 * const freshUser = await getUser.refresh()
 */
export const getUser = Object.assign(
  defineCachedFunction(async () => {
    const creds = extractUserCredentialsFromHeaders(useRequest())

    // TODO: ensure base url has not trailing slash

    // C8Y_BASE_URL is enforced to be set
    const client = new Client(new BasicAuth(creds), useRuntimeConfig().C8Y_BASE_URL)
    const {
      res,
      data: user,
    } = await client.user.current()

    if (!res.ok) {
      throw new HTTPError({
        message: `Failed to fetch current user`,
        status: res.status,
        statusText: res.statusText,
      })
    }
    return user
  }, {
    maxAge: 10 * 60, // 10 minutes
    name: '_c8y_nitro_get_user',
    group: 'c8y_nitro',
    getKey: () => {
      const creds = extractUserCredentialsFromHeaders(useRequest())

      return `_c8y_user_${JSON.stringify(creds)}`
    },
    swr: false,
  }),
  {
    invalidate: async () => {
      const creds = extractUserCredentialsFromHeaders(useRequest())
      const customPart = `_c8y_user_${JSON.stringify(creds)}`
      const completeKey = `c8y_nitro:functions:_c8y_nitro_get_user:${customPart}.json`
      await useStorage('cache').removeItem(completeKey)
    },
    refresh: async () => {
      // call the invalidate part
      await getUser.invalidate()
      // then call the function to refresh
      return await getUser()
    },
  },
)

/**
 * Fetches the roles of the current user from Cumulocity.\
 * Internally calls `getUser()` and extracts role IDs from the user object.\
 * Results are cached for 10 minutes per unique credentials.\
 * Must be called within a request handler context.\
 * @returns Array of role ID strings assigned to the current user
 * @example
 * // In a request handler:
 * const roles = await getUserRoles()
 * console.log(roles) // ['ROLE_INVENTORY_READ', 'ROLE_INVENTORY_ADMIN']
 *
 * // Invalidate cache:
 * await getUserRoles.invalidate()
 *
 * // Force refresh:
 * const freshRoles = await getUserRoles.refresh()
 */
export const getUserRoles = Object.assign(
  defineCachedFunction(async () => {
    const user = await getUser()
    // extract roles from user
    return (user.roles?.references.map((roleRef) => roleRef.id?.toString() ?? null).filter((id) => !!id) ?? []) as string[]
  }, {
    maxAge: 10 * 60, // 10 minutes
    name: '_c8y_nitro_get_user_roles',
    group: 'c8y_nitro',
    getKey: () => {
      const creds = extractUserCredentialsFromHeaders(useRequest())

      return `_c8y_user_roles_${JSON.stringify(creds)}`
    },
    swr: false,
  }),
  {
    invalidate: async () => {
      const creds = extractUserCredentialsFromHeaders(useRequest())
      const customPart = `_c8y_user_roles_${JSON.stringify(creds)}`
      const completeKey = `c8y_nitro:functions:_c8y_nitro_get_user_roles:${customPart}.json`
      await useStorage('cache').removeItem(completeKey)
    },
    refresh: async () => {
      // call the invalidate part
      await getUserRoles.invalidate()
      // then call the function to refresh
      return await getUserRoles()
    },
  },
)

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
      tenant: useRuntimeConfig().C8Y_BOOTSTRAP_TENANT,
      user: useRuntimeConfig().C8Y_BOOTSTRAP_USER,
      password: useRuntimeConfig().C8Y_BOOTSTRAP_PASSWORD,
    }, useRuntimeConfig().C8Y_BASE_URL)

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
