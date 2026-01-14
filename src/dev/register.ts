import type { Nitro } from 'nitro/types'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'pathe'

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

export async function registerRuntime(nitro: Nitro) {
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
  // const pluginPath = join(thisFilePath, './runtime/plugins/validate-config.ts')

  // but as runtime extensions are not supported here as pnpm resolves e.g. "useRuntimeConfig" to parent dir node_modules,
  // it throws an error as it is not the project's nitro runtime module.

  // though for everything else, we can normally include them via the options

  // TODO: move probes here as well

  // TODO: dev middleware to automatically inject LOCAL user into headers for dev
}
