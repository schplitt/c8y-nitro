/**
 * Registry of types generated from the manifest. Empty in the package; the
 * module's generated declarations (`node_modules/.c8y-nitro/types.d.ts`)
 * augment it with `tenantOptionKey` and `settingsCategory`.
 */
export interface C8YGenerated {}

/**
 * Per-key cache TTL configuration for tenant options.
 * Narrowed by the generated types from manifest settings (manifest.settings[].key).
 */
export type C8YTenantOptionKeysCacheConfig = Partial<Record<C8YTenantOptionKey, number>>

/**
 * Union of tenant option keys declared in `manifest.settings`.
 * Narrowed by the generated types from manifest settings (manifest.settings[].key);
 * `string` without them.
 */
export type C8YTenantOptionKey = C8YGenerated extends { tenantOptionKey: infer K extends string } ? K : string

/**
 * The microservice's own tenant option settings category, resolved from
 * `manifest.settingsCategory` (falling back to `contextPath`, then `name`).
 * Narrowed by the generated types from the manifest; `string` without them.
 */
export type C8YSettingsCategory = C8YGenerated extends { settingsCategory: infer C extends string } ? C : string
