import type { Nitro } from 'nitro/types'
import type { C8yNitroModuleOptions } from '../types'
import { createC8yManifest } from './manifest'

/**
 * Sets up runtime configuration values from module options.
 * These can be overridden by environment variables.
 * @param nitro - The Nitro instance
 * @param options - The c8y-nitro module options
 */
export async function setupRuntimeConfig(nitro: Nitro, options: C8yNitroModuleOptions): Promise<void> {
  nitro.logger.debug('Setting up C8Y runtime config')

  // Credentials cache TTL (can be overridden by NITRO_C8Y_CREDENTIALS_CACHE_TTL env var)
  nitro.options.runtimeConfig.c8yCredentialsCacheTTL = options.cache?.credentialsTTL ?? 600

  // Tenant options cache configuration
  nitro.options.runtimeConfig.c8yDefaultTenantOptionsTTL = options.cache?.defaultTenantOptionsTTL ?? 600
  nitro.options.runtimeConfig.c8yTenantOptionsPerKeyTTL = options.cache?.tenantOptions ?? {}

  // Settings category (falls back to contextPath from manifest, then name from manifest)
  const manifest = await createC8yManifest(nitro.options.rootDir, options.manifest, nitro.logger)
  nitro.options.runtimeConfig.c8ySettingsCategory = options.manifest?.settingsCategory
    ?? manifest.contextPath
    ?? manifest.name
}
