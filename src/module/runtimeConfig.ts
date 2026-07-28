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

  // Tenant domain cache TTL (can be overridden by NITRO_C8Y_TENANT_DOMAIN_CACHE_TTL env var)
  nitro.options.runtimeConfig.c8yTenantDomainCacheTTL = options.cache?.tenantDomainTTL ?? 86400

  // Settings category (falls back to contextPath from manifest, then name from manifest)
  const manifest = await createC8yManifest(nitro.options.rootDir, nitro.options, nitro.logger)
  nitro.options.runtimeConfig.c8ySettingsCategory = options.manifest?.settingsCategory
    ?? manifest.contextPath
    ?? manifest.name

  // OpenAPI document transformation (consumed by the runtime/handlers/openapi middleware)
  const excludeInternalRoutes = options.openapi?.excludeInternalRoutes ?? true
  const probePaths = [
    options.manifest?.livenessProbe?.httpGet?.path,
    options.manifest?.readinessProbe?.httpGet?.path,
  ].filter((path): path is string => Boolean(path))
  nitro.options.runtimeConfig.c8yOpenApiExcludeRoutes = [
    ...(excludeInternalRoutes ? ['/_', ...probePaths] : []),
    ...(options.openapi?.excludeRoutes ?? []),
  ]
  // Route the transform middleware reacts to (mirrors nitro's default)
  nitro.options.runtimeConfig.c8yOpenApiRoute = nitro.options.openAPI?.route || '/_openapi.json'
  nitro.options.runtimeConfig.c8yContextPath = manifest.contextPath ?? manifest.name
  // In dev the service is reached directly (localhost), so the request origin is
  // the correct server URL. When deployed, requests arrive via the platform proxy
  // under the tenant domain, which we resolve through the requesting user's client.
  // `??=` keeps explicit runtimeConfig overrides (e.g. from tests) intact.
  nitro.options.runtimeConfig.c8yOpenApiUseTenantDomain ??= !nitro.options.dev
}
