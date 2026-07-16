export interface CachedTenantOptionFetcher {
  (): Promise<string | undefined>
  invalidate: () => Promise<void>
  refresh: () => Promise<string | undefined>
}

/**
 * Internal storage for cached option fetchers, keyed by
 * `${tenant}::${category}::${key}`.
 *
 * Including the tenant and category in the key keeps options from different
 * tenants (multi-tenancy) and settings categories from colliding on a shared
 * `key`.
 */
export const tenantOptionFetchers: Record<string, CachedTenantOptionFetcher> = {}

/**
 * Builds the composite store key for a tenant/category/key triple.
 * @param tenant - The tenant id owning the option
 * @param category - The settings category
 * @param key - The tenant option key
 */
export function fetcherStoreKey(tenant: string, category: string, key: string): string {
  return `${tenant}::${category}::${key}`
}
