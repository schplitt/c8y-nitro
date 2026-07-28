import type { C8YTenantOptionKeysCacheConfig } from 'c8y-nitro/types'

export interface C8yCacheOptions {
  /**
   * Cache TTL for subscribed tenant credentials in seconds.
   * @default 600 (10 minutes)
   */
  credentialsTTL?: number

  /**
   * Default cache TTL for tenant options in seconds.
   * Applied to all keys unless overridden in `tenantOptions`.
   * @default 600 (10 minutes)
   */
  defaultTenantOptionsTTL?: number

  /**
   * Cache TTL for resolved tenant domains in seconds (per tenant ID).
   * Tenant domains rarely change, so a long TTL is safe.
   * @default 86400 (24 hours)
   */
  tenantDomainTTL?: number

  /**
   * Per-key cache TTL overrides for tenant options in seconds.
   * Keys should match those defined in `manifest.settings[].key`.
   * @example
   * {
   *   'myOption': 300,           // 5 minutes
   *   'credentials.secret': 60,  // 1 minute
   * }
   */
  tenantOptions?: C8YTenantOptionKeysCacheConfig
}
