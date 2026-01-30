import type { NitroModule } from 'nitro/types'
import type { C8yNitroModuleOptions } from './types'
import { writeAPIClient } from './module/apiClient'
import { createC8yZip } from './module/c8yzip'
import { setupRuntime } from './module/runtime'
import { registerRuntime } from './module/register'
import { checkProbes } from './module/probeCheck'
import { autoBootstrap } from './module/autoBootstrap'
import { name as pkgName } from '../package.json'

declare module 'nitro/types' {
  interface NitroOptions {
    c8y?: C8yNitroModuleOptions
  }
}
export function c8y(): NitroModule {
  return {
    name: 'c8y-nitro',
    setup: async (nitro) => {
      const options = nitro.options.c8y ?? {}

      // enable tsconfig generation
      nitro.options.typescript.generateTsConfig = true
      // workaround as the generated tsconfig creates an invalid extends entry
      // https://github.com/nitrojs/nitro/issues/3945
      nitro.options.typescript.tsConfig = {}
      nitro.options.typescript.tsConfig.include = ['./**/*.d.ts']
      nitro.options.typescript.tsConfig.exclude = []

      // set own library (pkgName) as noExternal to bundle it always
      // makes runtime nitro features available in c8y-nitro utilities
      // avoids esm issues with @c8y/client
      nitro.options.noExternals = nitro.options.noExternals && nitro.options.noExternals === true ? nitro.options.noExternals : [...(nitro.options.noExternals || []), pkgName, '@c8y/client']

      // setup preset
      if (!nitro.options.preset.startsWith('nitro') && !nitro.options.preset.startsWith('node')) {
        nitro.logger.error(`Unsupported preset "${nitro.options.preset}" for c8y-nitro module, only node presets are supported.`)
        throw new Error('Unsupported preset for c8y-nitro module')
      }

      // Auto-bootstrap if needed (silent if already bootstrapped)
      await autoBootstrap(nitro)

      setupRuntime(nitro, options.manifest)

      nitro.hooks.hook('dev:reload', async () => {
        setupRuntime(nitro, options.manifest)
        if (options.apiClient) {
          nitro.logger.debug('Generating C8Y API client')
          await writeAPIClient(nitro, options)
        }
      })

      nitro.hooks.hook('build:before', async () => {
        registerRuntime(nitro, options)

        // Check probes when all things are registered
        if (options.manifest) {
          checkProbes(nitro, options.manifest)
        }
      })

      nitro.hooks.hook('types:extend', async () => {
        if (options.apiClient) {
          nitro.logger.debug('Generating C8Y API client')
          await writeAPIClient(nitro, options)
        }
      })

      nitro.hooks.hook('close', async () => {
        // Build the Docker image when not in dev mode
        if (nitro.options.preset !== 'nitro-dev') {
          await createC8yZip(nitro, options.zip)
        }
      })
    },
  }
}

export default c8y
