import type { C8YAPIClientOptions } from './apiClient'
import type { C8YManifestOptions } from './manifest'
import type { C8YZipOptions } from './zip'
import type { C8yCacheOptions } from './cache'

export type * from './zip'
export type { C8YManifestOptions, C8YManifest } from './manifest'
export * from './apiClient'
export type { C8yCacheOptions } from './cache'

export interface C8yDevOptions {
  /**
   * Automatically inject the configured development user into incoming requests
   * during local Nitro dev mode.
   *
   * Disable this when a local proxy already forwards the desired user context.
   * @default true
   */
  injectUser?: boolean
}

// overwritten by module with info from manifest
export * from './roles'
export * from './tenantOptions'

export interface C8yNitroModuleOptions {
  dev?: C8yDevOptions
  manifest?: C8YManifestOptions
  apiClient?: C8YAPIClientOptions
  zip?: C8YZipOptions
  cache?: C8yCacheOptions
  /**
   * Adds a debug route for invalidating already-created tenant option caches.
   * Exposes `GET /_c8y_nitro/invalidate-tenant-options`.
   *
   * Query params:
   * - `all`: invalidate all created tenant option fetchers
   * - `key`: invalidate a single manifest-defined tenant option key if its fetcher exists
   *
   * `all` takes priority over `key`.
   * @default false
   */
  enableTenantOptionsInvalidationRoute?: boolean
  /**
   * Disable auto-bootstrap during development.
   * When true, the module will not automatically register the microservice
   * or retrieve bootstrap credentials on startup.
   *
   * Useful for CI/CD pipelines or manual bootstrap management.
   * @default false
   */
  skipBootstrap?: boolean
}
