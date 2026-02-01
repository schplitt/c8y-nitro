/**
 * Per-key cache TTL configuration for tenant options.
 * Keys should match those defined in `manifest.settings[].key`.
 */
export type C8YTenantOptionKeysCacheConfig = Partial<Record<C8YTenantOptionKey, number>>

/**
 * Type for tenant option keys.
 * Overwritten by generated types from manifest settings.
 */
export type C8YTenantOptionKey = string
