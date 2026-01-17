import type { Nitro } from 'nitro/types'
import type { C8yNitroModuleOptions } from '../types'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'pathe'
import { GENERATED_LIVENESS_ROUTE, GENERATED_READINESS_ROUTE } from './constants'

const validateConfigPlugin = `import { useRuntimeConfig } from 'nitro/runtime-config'
import { definePlugin } from 'nitro'

export default definePlugin(() => {
  const config = useRuntimeConfig()

  const requiredVars = ['C8Y_BASE_URL', 'C8Y_BOOTSTRAP_TENANT', 'C8Y_BOOTSTRAP_USER', 'C8Y_BOOTSTRAP_PASSWORD']
  const missingVars = requiredVars.filter((varName) => !config[varName])

  if (missingVars.length > 0) {
    throw new Error(\`Missing required runtime configuration variables: \${missingVars.join(', ')}. Set them in your .env file and restart the server.\`)
  }
})`

export async function registerRuntime(nitro: Nitro, options: C8yNitroModuleOptions = {}) {
  // Generate directory for runtime files
  const runtimeDir = join(nitro.options.rootDir, 'node_modules', '.c8y_nitro')
  await mkdir(runtimeDir, { recursive: true })

  // Write validate-config plugin
  const pluginPath = join(runtimeDir, 'validate-config.ts')
  await writeFile(pluginPath, validateConfigPlugin, 'utf-8')

  // Register the plugin
  nitro.options.plugins.push(pluginPath)

  nitro.logger.debug('Registered c8y-nitro runtime validation plugin')

  // normally the plugins, routes and middleware is in runtime/... and then registerd with
  // const thisFilePath = fileURLToPath(new URL('.', import.meta.url))
  // const pluginPath = join(thisFilePath, './runtime/plugins/validate-config')

  // but as runtime extensions are not supported here as pnpm resolves e.g. "useRuntimeConfig" to parent dir node_modules,
  // it throws an error as it is not the project's nitro runtime module.

  // though for everything else, we can normally include them via the options

  // Register probe handlers using fileURLToPath
  const thisFilePath = fileURLToPath(new URL('.', import.meta.url))
  const probeHandlerPath = join(thisFilePath, './runtime/handlers/liveness-readiness')

  // TODO: nitro currently only shows the last registered handler in swagger/scalar

  // Generate liveness probe if user hasn't defined httpGet
  if (!options.manifest?.livenessProbe?.httpGet) {
    nitro.options.handlers.push({
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
    nitro.options.handlers.push({
      route: GENERATED_READINESS_ROUTE,
      handler: probeHandlerPath,
      method: 'GET',
    })

    nitro.logger.debug(`Generated readiness probe at ${GENERATED_READINESS_ROUTE}`)
  } else {
    nitro.logger.debug('Readiness probe httpGet defined by user; skipping generation')
  }
}
