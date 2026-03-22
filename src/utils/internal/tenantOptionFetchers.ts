import type { C8YTenantOptionKey } from 'c8y-nitro/types'

export interface CachedTenantOptionFetcher {
  (): Promise<string | undefined>
  invalidate: () => Promise<void>
  refresh: () => Promise<string | undefined>
}

/**
 * Internal storage for cached functions per key
 */
export const tenantOptionFetchers: Partial<Record<C8YTenantOptionKey, CachedTenantOptionFetcher>> = {}
