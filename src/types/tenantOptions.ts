/**
 * Per-key cache TTL configuration for tenant options.
 * Overwritten by generated types from manifest settings (manifest.settings[].key).
 */
export type C8YTenantOptionKeysCacheConfig = Partial<Record<C8YTenantOptionKey, number>>

/**
 * Union of tenant option keys declared in `manifest.settings`.
 * Overwritten by generated types from manifest settings (manifest.settings[].key).
 */
export type C8YTenantOptionKey = string

/**
 * The microservice's own tenant option settings category, resolved from
 * `manifest.settingsCategory` (falling back to `contextPath`, then `name`).
 * Overwritten by generated types from the manifest.
 */
export type C8YSettingsCategory = string
