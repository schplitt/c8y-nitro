import type { Nitro } from 'nitro/types'
import type { C8yNitroModuleOptions } from '../types'

/**
 * Sets up runtime configuration values from module options.
 * These can be overridden by environment variables.
 * @param nitro - The Nitro instance
 * @param options - The c8y-nitro module options
 */
export function setupRuntimeConfig(nitro: Nitro, options: C8yNitroModuleOptions): void {
  nitro.logger.debug('Setting up C8Y runtime config')

  // Credentials cache TTL (can be overridden by NITRO_C8Y_CREDENTIALS_CACHE_TTL env var)
  nitro.options.runtimeConfig.c8yCredentialsCacheTTL = options.cache?.credentialsTTL ?? 600
}
