import type { Nitro } from 'nitro/types'
import type { C8yNitroModuleOptions } from '../types'
import { createC8yManifest } from './manifest'
import { isValidRealtimeName, toRealtimeName } from 'c8y-realtime'
import { createHash } from 'node:crypto'

/**
 * Derive a stable, unique realtime client name from the microservice identity
 * (its `contextPath`, falling back to `name`).
 *
 * The identity is sanitized to Cumulocity's alphanumeric name rule via
 * `toRealtimeName`, then a short deterministic hash of the **raw** identity is
 * appended. Sanitizing is lossy (`my-svc` and `my_svc` both become `mysvc`), so
 * the hash restores the per-service uniqueness the `contextPath` guaranteed —
 * without it, two different services could share one platform topic and clobber
 * each other's subscriptions. Being deterministic, the name is identical across
 * restarts and redeploys, so a reconnecting service resumes the same persistent
 * subscription (and its backlog). This scheme is a permanent identity contract:
 * changing it orphans existing subscriptions.
 * @param identity - The microservice `contextPath` (or `name`)
 */
function deriveRealtimeName(identity: string): string {
  const base = toRealtimeName(identity)
  const hash = createHash('sha256').update(identity).digest('hex').slice(0, 8)
  return `${base}${hash}`
}

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
  const manifest = await createC8yManifest(nitro.options.rootDir, nitro.options, nitro.logger)
  nitro.options.runtimeConfig.c8ySettingsCategory = options.manifest?.settingsCategory
    ?? manifest.contextPath
    ?? manifest.name

  // Realtime (Notification 2.0) config — resolved once here and spread into every
  // pooled per-tenant RealtimeClient at runtime, so all tenants behave the same.
  const realtime = options.realtime ?? {}
  const realtimeName = realtime.name ?? deriveRealtimeName(manifest.contextPath ?? manifest.name)
  if (!isValidRealtimeName(realtimeName)) {
    throw new Error(
      `c8y-nitro: invalid realtime name ${JSON.stringify(realtimeName)} — must be alphanumeric `
      + '(^[a-zA-Z0-9]+$). Set `c8y.realtime.name` to a valid value.',
    )
  }
  nitro.options.runtimeConfig.c8yRealtime = {
    name: realtimeName,
    autoAck: realtime.autoAck ?? true,
    dedupe: realtime.dedupe ?? true,
    autoStart: realtime.autoStart ?? true,
    deleteSubscriptionOnEmpty: realtime.deleteSubscriptionOnEmpty ?? true,
    deleteSubscriptionsOnClose: realtime.deleteSubscriptionsOnClose ?? false,
    subscription: realtime.subscription,
    resilience: realtime.resilience,
  }

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
}
