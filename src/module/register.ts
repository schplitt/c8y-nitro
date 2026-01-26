import type { Nitro, NitroEventHandler } from 'nitro/types'
import type { C8yNitroModuleOptions } from '../types'
import { fileURLToPath } from 'node:url'
import { join } from 'pathe'
import { GENERATED_LIVENESS_ROUTE, GENERATED_READINESS_ROUTE } from './constants'

/**
 * Links runtime middleware, handlers, and plugins to the nitro instance.
 * Works by having the handlers in a relative path to this file.
 * Needs to be the same when built.
 * @param nitro - Nitro instance
 * @param options - C8yNitroModuleOptions
 */
export function registerRuntime(nitro: Nitro, options: C8yNitroModuleOptions = {}) {
  const thisFilePath = fileURLToPath(new URL('.', import.meta.url))

  /**
   * Plugins
   */
  const plugins: string[] = []
  const c8yVariablesPluginPath = join(thisFilePath, './runtime/plugins/c8y-variables')
  plugins.push(c8yVariablesPluginPath)
  nitro.options.plugins.push(...plugins)

  /**
   * Middlewares (global)
   */
  const middlewares: string[] = []
  const devUserMiddlewarePath = join(thisFilePath, './runtime/middlewares/dev-user')
  middlewares.push(
    devUserMiddlewarePath,
  )

  nitro.options.handlers.push(...middlewares.map((handler) => ({
    route: '/**',
    handler,
    middleware: true,
  })))

  /**
   * Handlers
   */
  // TODO: investigate nitro currently only shows the last registered handler in swagger/scalar
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

  nitro.options.handlers.push(...handlers)
}
