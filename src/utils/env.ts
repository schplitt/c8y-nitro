import type { Nitro } from 'nitro/types'

/**
 * Setup Cumulocity environment variables in Nitro runtime config.
 * @param nitro Nitro instance
 */
export function setupRuntimeConfig(nitro: Nitro) {
  // Set env prefix to empty string to allow all C8Y_ env vars
  nitro.options.runtimeConfig.nitro.envPrefix = ''

  // Register Cumulocity environment variables in runtime config
  // This makes them accessible via useRuntimeConfig() and allows
  // overriding via environment variables at runtime (e.g., in Docker)

  /**
   * Base URL of Cumulocity (valid for all tenants).
   * @example "https://cumulocity.com" | "https://cumulocity:8111"
   */
  nitro.options.runtimeConfig.C8Y_BASE_URL = ''

  /**
   * Application owner tenant ID (bootstrap credentials).
   */
  nitro.options.runtimeConfig.C8Y_BOOTSTRAP_TENANT = ''

  /**
   * Username of the bootstrap user (owner tenant).
   */
  nitro.options.runtimeConfig.C8Y_BOOTSTRAP_USER = ''

  /**
   * Password of the bootstrap user (owner tenant).
   */
  nitro.options.runtimeConfig.C8Y_BOOTSTRAP_PASSWORD = ''

  /**
   * Subscribed tenant ID (per-tenant credentials).
   */
  nitro.options.runtimeConfig.C8Y_TENANT = ''

  /**
   * Username of the service user for a subscribed tenant.
   */
  nitro.options.runtimeConfig.C8Y_USER = ''

  /**
   * Password of the service user for a subscribed tenant.
   */
  nitro.options.runtimeConfig.C8Y_PASSWORD = ''
}
