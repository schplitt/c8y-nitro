import type { Nitro, NitroEventHandler } from 'nitro/types'
import type { C8yNitroModuleOptions } from '../types'
import { fileURLToPath } from 'node:url'
import { join } from 'pathe'
import {
  GENERATED_INVALIDATE_TENANT_OPTIONS_ROUTE,
  GENERATED_LIVENESS_ROUTE,
  GENERATED_READINESS_ROUTE,
} from './constants'

/**
 * Links runtime middleware, handlers, and plugins to the nitro instance.
 * Works by having the handlers in a relative path to this file.
 * Needs to be the same when built.
 * @param nitro - Nitro instance
 * @param options - C8yNitroModuleOptions
 */
export function registerRuntime(nitro: Nitro, options: C8yNitroModuleOptions = {}) {
  const thisFilePath = fileURLToPath(new URL('.', import.meta.url))
  const isNitroDev = nitro.options.preset === 'nitro-dev'

  const shouldIncludeRuntimeFile = (relativePath: string): boolean => {
    const isDevOnlyFile = relativePath.endsWith('.dev.ts')

    if (isDevOnlyFile && !isNitroDev) {
      return false
    }

    if (relativePath.endsWith('/dev-user.dev.ts') && options.dev?.injectUser === false) {
      return false
    }

    return true
  }

  const toRuntimePath = (relativePath: string) => join(thisFilePath, relativePath.replace(/\.ts$/, ''))

  // @ts-expect-error - import.meta.glob is not typed
  const allPlugins = Object.keys(import.meta.glob('./runtime/plugins/*.ts', { eager: true }))
    .filter(shouldIncludeRuntimeFile)
    .map(toRuntimePath)
  // @ts-expect-error - import.meta.glob is not typed
  const allMiddlewares = Object.keys(import.meta.glob('./runtime/middlewares/*.ts', { eager: true }))
    .filter(shouldIncludeRuntimeFile)
    .map(toRuntimePath)

  /**
   * Plugins (auto scanned)
   */
  nitro.options.plugins.push(...allPlugins)

  /**
   * Middlewares (auto scanned)
   */
  nitro.options.handlers.push(...allMiddlewares.map((handler) => ({
    route: '/**',
    handler,
    middleware: true,
  })))

  /**
   * Request URL rewrite middleware (always on in production builds).
   * Rewrites `event.url` to the public tenant endpoint so handlers that build
   * absolute URLs from the request don't leak internal cluster URLs.
   * Registered after the scanned middlewares (which observe the original
   * cluster-local URL) and before the OpenAPI transform, which reuses the
   * resolved tenant domain from its cache.
   */
  if (!isNitroDev) {
    nitro.options.handlers.push({
      route: '/**',
      handler: join(thisFilePath, './runtime/handlers/rewriteRequestUrl'),
      middleware: true,
    })
    nitro.logger.debug('Registered public request URL rewrite middleware')
  }

  /**
   * OpenAPI transform middleware (scoped to the OpenAPI JSON route)
   * Strips internal routes and rewrites the server URL to the requesting origin.
   */
  const openApiEnabled = Boolean(nitro.options.experimental?.openAPI
    && (isNitroDev || nitro.options.openAPI?.production))
  if (openApiEnabled) {
    if (!isNitroDev && nitro.options.openAPI?.production === 'prerender') {
      // Prerendered specs are served as static assets before routed middleware
      // runs, so they can neither hide internal routes nor reflect the
      // per-request server URL (it is baked in at build time).
      nitro.logger.warn('c8y-nitro cannot transform a prerendered OpenAPI document (internal routes stay listed and the server URL is baked in at build time). Use `openAPI: { production: true }` to serve the document at runtime instead.')
    } else {
      // Registered globally (the middleware exits early on other paths).
      // Route-scoping this is not possible: global middleware runs before
      // nitro's routed-middleware matcher, so the rewriteRequestUrl middleware
      // above has already rewritten `event.url.pathname` to the public
      // /service/<contextPath>/... form by the time a route match is attempted.
      nitro.options.handlers.push({
        route: '/**',
        handler: join(thisFilePath, './runtime/handlers/openapi'),
        middleware: true,
      })
      nitro.logger.debug(`Registered OpenAPI transform middleware for ${nitro.options.openAPI?.route || '/_openapi.json'}`)
    }
  }

  /**
   * Handlers (can't be auto scanned as they need methods etc)
   */
  const handlers: NitroEventHandler[] = []
  const probeHandlerPath = join(thisFilePath, './runtime/handlers/liveness-readiness')
  // Generate liveness probe if user hasn't defined httpGet
  // TODO: think about maybe not allowing user to manually define probes
  if (!options.manifest?.livenessProbe?.httpGet) {
    handlers.push({
      route: GENERATED_LIVENESS_ROUTE,
      handler: probeHandlerPath,
      method: 'GET',
    })
    nitro.logger.debug(`Generated liveness probe at ${GENERATED_LIVENESS_ROUTE}`)
  } else {
    nitro.logger.debug('Liveness probe httpGet defined by user; skipping generation')
  }
  // Generate readiness probe if user hasn't defined httpGet
  if (!options.manifest?.readinessProbe?.httpGet) {
    handlers.push({
      route: GENERATED_READINESS_ROUTE,
      handler: probeHandlerPath,
      method: 'GET',
    })
    nitro.logger.debug(`Generated readiness probe at ${GENERATED_READINESS_ROUTE}`)
  } else {
    nitro.logger.debug('Readiness probe httpGet defined by user; skipping generation')
  }

  // Add tenant option invalidation route if enabled by user
  if (options.enableTenantOptionsInvalidationRoute) {
    const invalidateTenantOptionsHandlerPath = join(thisFilePath, './runtime/handlers/invalidateTenantOptions')
    handlers.push({
      route: GENERATED_INVALIDATE_TENANT_OPTIONS_ROUTE,
      handler: invalidateTenantOptionsHandlerPath,
      method: 'GET',
    })
    nitro.logger.debug(`Generated tenant option invalidation route at ${GENERATED_INVALIDATE_TENANT_OPTIONS_ROUTE}`)
  }

  nitro.options.handlers.push(...handlers)
}
