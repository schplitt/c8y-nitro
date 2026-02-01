import { defineCachedFunction } from 'nitro/cache'
import { useStorage } from 'nitro/storage'
import { useRuntimeConfig } from 'nitro/runtime-config'
import { useDeployedTenantClient } from './client'
import type { C8YTenantOptionKey } from 'c8y-nitro/types'

/**
 * Gets the cache TTL for a specific tenant option key.
 * Uses per-key override if defined, otherwise falls back to default TTL.
 * @param key - The tenant option key
 */
function getTenantOptionCacheTTL(key: C8YTenantOptionKey): number {
  const config = useRuntimeConfig()
  const perKeyTTL = config.c8yTenantOptionsPerKeyTTL as Record<string, number> | undefined
  return perKeyTTL?.[key] ?? (config.c8yDefaultTenantOptionsTTL as number) ?? 600
}

interface CachedTenantOptionFetcher {
  (): Promise<string | undefined>
  invalidate: () => Promise<void>
  refresh: () => Promise<string | undefined>
}

/**
 * Internal storage for cached functions per key
 */
const tenantOptionFetchers: Record<C8YTenantOptionKey, CachedTenantOptionFetcher> = {}

/**
 * Factory function that creates a cached fetcher for a specific tenant option key.
 * @param key - The tenant option key
 */
function createCachedTenantOptionFetcher(key: C8YTenantOptionKey): CachedTenantOptionFetcher {
  const cacheName = `_c8y_nitro_tenant_option_${key.replace(/\./g, '_')}`

  const fetcher = defineCachedFunction(
    async (): Promise<string | undefined> => {
      const client = await useDeployedTenantClient()
      const category = useRuntimeConfig().c8ySettingsCategory as string
      // Strip credentials. prefix for API call only
      const apiKey = key.replace(/^credentials\./, '')

      try {
        const response = await client.options.tenant.detail({
          key: apiKey,
          category,
        })
        return response.data.value
      } catch (error: any) {
        // 404 means option is not set - return undefined
        if (error?.res?.status === 404 || error?.status === 404) {
          return undefined
        }
        // Other errors should be thrown
        throw error
      }
    },
    {
      maxAge: getTenantOptionCacheTTL(key),
      name: cacheName,
      group: 'c8y_nitro',
      swr: false,
    },
  )

  return Object.assign(fetcher, {
    invalidate: async (): Promise<void> => {
      const completeKey = `c8y_nitro:functions:${cacheName}.json`
      await useStorage('cache').removeItem(completeKey)
    },
    refresh: async (): Promise<string | undefined> => {
      const completeKey = `c8y_nitro:functions:${cacheName}.json`
      await useStorage('cache').removeItem(completeKey)
      return await fetcher()
    },
  })
}

/**
 * Gets or creates a cached fetcher for a specific tenant option key.
 * @param key - The tenant option key
 */
function getOrCreateFetcher(key: C8YTenantOptionKey): CachedTenantOptionFetcher {
  let fetcher = tenantOptionFetchers[key]
  if (!fetcher) {
    fetcher = createCachedTenantOptionFetcher(key)
    tenantOptionFetchers[key] = fetcher
  }
  return fetcher
}

/**
 * Fetches a tenant option value by key.\
 * Uses the deployed tenant's service user credentials to access the Options API.\
 * Results are cached based on the configured TTL (default: 10 minutes).
 *
 * @param key - The tenant option key to fetch (as defined in `manifest.settings`)
 * @returns The option value as a string
 *
 * @config Cache TTL can be configured via:
 * - `c8y.cache.defaultTenantOptionsTTL` — Default TTL for all keys (in seconds)
 * - `c8y.cache.tenantOptions` — Per-key TTL overrides
 * - `NITRO_C8Y_DEFAULT_TENANT_OPTIONS_TTL` — Environment variable for default TTL
 *
 * @note For encrypted options (keys starting with `credentials.`), the value is automatically
 * decrypted by Cumulocity if this microservice is the owner of the option (category matches
 * the microservice's settingsCategory/contextPath/name). The `credentials.` prefix is
 * automatically stripped when calling the API.
 *
 * @example
 * // Fetch a tenant option:
 * const value = await useTenantOption('myOption')
 *
 * // Fetch an encrypted secret:
 * const secret = await useTenantOption('credentials.apiKey')
 *
 * // Invalidate cache for a specific key:
 * await useTenantOption.invalidate('myOption')
 *
 * // Force refresh a specific key:
 * const fresh = await useTenantOption.refresh('myOption')
 *
 * // Invalidate all tenant option caches:
 * await useTenantOption.invalidateAll()
 *
 * // Refresh all tenant options:
 * const all = await useTenantOption.refreshAll()
 */
export const useTenantOption = Object.assign(
  async (key: C8YTenantOptionKey): Promise<string | undefined> => {
    const fetcher = getOrCreateFetcher(key)
    return await fetcher()
  },
  {
    /**
     * Invalidate the cache for a specific tenant option key.
     * @param key - The tenant option key to invalidate
     */
    invalidate: async (key: C8YTenantOptionKey): Promise<void> => {
      const fetcher = tenantOptionFetchers[key]
      if (fetcher) {
        await fetcher.invalidate()
      }
    },

    /**
     * Force refresh a specific tenant option key (invalidates and re-fetches).
     * @param key - The tenant option key to refresh
     */
    refresh: async (key: C8YTenantOptionKey): Promise<string | undefined> => {
      const fetcher = getOrCreateFetcher(key)
      return await fetcher.refresh()
    },

    /**
     * Invalidate all tenant option caches that have been accessed.
     * Only invalidates keys that have been fetched at least once.
     */
    invalidateAll: async (): Promise<void> => {
      await Promise.all(
        Object.values(tenantOptionFetchers).map((fetcher) => fetcher.invalidate()),
      )
    },

    /**
     * Refresh all tenant options that have been accessed.
     * Only refreshes keys that have been fetched at least once.
     * @returns Object mapping keys to their refreshed values
     */
    refreshAll: async (): Promise<Record<string, string | undefined>> => {
      const entries = Object.entries(tenantOptionFetchers)
      const values = await Promise.all(entries.map(([, fetcher]) => fetcher.refresh()))
      return Object.fromEntries(entries.map(([key], i) => [key, values[i]]))
    },
  },
)
