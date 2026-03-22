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

  // @ts-expect-error - import.meta.glob is not typed
  const allPlugins = Object.keys(import.meta.glob('./runtime/plugins/*.ts', { eager: true })).map((p) => join(thisFilePath, p.replace('.ts', '')))
  // @ts-expect-error - import.meta.glob is not typed
  const allMiddlewares = Object.keys(import.meta.glob('./runtime/middlewares/*.ts', { eager: true })).map((p) => join(thisFilePath, p.replace('.ts', '')))

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
   * Handlers (can't be auto scanned as they need methods etc)
   */
  // TODO: investigate nitro currently only shows the last registered handler in swagger/scalar -> openapi json can be intercepted and modified with middleware if needed
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
