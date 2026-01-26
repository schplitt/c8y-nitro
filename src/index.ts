import type { NitroModule } from 'nitro/types'
import type { C8yNitroModuleOptions } from './types'
import { writeAPIClient } from './module/apiClient'
import { createC8yZip } from './module/c8yzip'
import { setupRuntime } from './module/runtime'
import { registerRuntime } from './module/register'
import { checkProbes } from './module/probeCheck'
import { autoBootstrap } from './module/autoBootstrap'

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
      nitro.options.typescript.tsConfig = {
        ...nitro.options.typescript.tsConfig,
      }
      nitro.options.typescript.tsConfig.include = ['./**/*.d.ts']
      nitro.options.typescript.tsConfig.exclude = []

      // allow async context
      nitro.options.experimental.asyncContext = true

      // Auto-bootstrap if needed (silent if already bootstrapped)
      await autoBootstrap(nitro)

      setupRuntime(nitro, options.manifest)
      registerRuntime(nitro, options)

      nitro.hooks.hook('dev:reload', () => {
        setupRuntime(nitro, options.manifest)
      })

      // setup preset
      nitro.options.preset = 'node-server'

      nitro.hooks.hook('build:before', async () => {
        // Check probes when all things are registered
        if (options.manifest) {
          checkProbes(nitro, options.manifest)
        }
      })

      nitro.hooks.hook('types:extend', async () => {
        if (options.apiClient) {
          // TODO: maybe move to dev as it needs to be written when routes change/save
          nitro.logger.debug('Generating C8Y API client')
          await writeAPIClient(nitro, options)
        }
      })

      nitro.hooks.hook('close', async () => {
        // TODO: currently runs everytime server stops, should only run AFTER build (without default build log output)
        // Build the Docker image
        await createC8yZip(nitro, options.zip)
      })
    },
  }
}

export default c8y
