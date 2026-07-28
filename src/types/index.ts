import type { C8YAPIClientOptions } from './apiClient'
import type { C8YManifestOptions } from './manifest'
import type { C8YZipOptions } from './zip'
import type { C8yCacheOptions } from './cache'
import type { C8yDockerOptions } from './docker'

export type * from './zip'
export type { C8yDockerOptions } from './docker'
export type { C8YManifestOptions, C8YManifest } from './manifest'
export * from './apiClient'
export type { C8yCacheOptions } from './cache'
export type { TenantCredentials } from './credentials'

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

export interface C8yOpenAPIOptions {
  /**
   * Strip internal routes from the served OpenAPI document.
   * Removes every route starting with `/_` (generated probes, `/_c8y_nitro/**`
   * and the OpenAPI/Scalar/Swagger routes themselves) as well as user-defined
   * probe `httpGet` paths.
   * @default true
   */
  excludeInternalRoutes?: boolean
  /**
   * Additional route prefixes to strip from the served OpenAPI document.
   * Entries are matched as path prefixes (e.g. `/internal` also removes `/internal/status`).
   * @default []
   */
  excludeRoutes?: string[]
}

export interface C8yNitroModuleOptions {
  dev?: C8yDevOptions
  manifest?: C8YManifestOptions
  apiClient?: C8YAPIClientOptions
  zip?: C8YZipOptions
  /**
   * Controls the Dockerfile generated for the microservice image
   * (base image, extra instructions).
   */
  docker?: C8yDockerOptions
  cache?: C8yCacheOptions
  /**
   * Controls how the OpenAPI document served by Nitro (`experimental.openAPI`)
   * is transformed for Cumulocity microservices.
   */
  openapi?: C8yOpenAPIOptions
  /**
   * Adds a debug route for invalidating already-created tenant option caches.
   * Exposes `GET /_c8y_nitro/invalidate-tenant-options`.
   *
   * Query params:
   * - `all`: invalidate all created tenant option fetchers
   * - `key`: invalidate a single manifest-defined tenant option key if it exists
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
