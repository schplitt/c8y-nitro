import type { NitroModule } from 'nitro/types'
import type { C8yNitroModuleOptions } from './types'
import { setupRuntimeConfig } from './dev/env'
import { writeAPIClient } from './dev/apiClient'
import { createC8yZip } from './dev/c8yzip'
import { checkProbes, setupProbes } from './runtime/probes'

export function c8y(options: C8yNitroModuleOptions = {}): NitroModule {
  return {
    name: 'c8y-nitro',
    setup: async (nitro) => {
      setupRuntimeConfig(nitro)

      // setup preset
      nitro.options.preset = 'node-server'

      nitro.hooks.hook('build:before', async () => {
        // Setup probes first, then check user-defined ones
        await setupProbes(nitro, options.manifest)

        if (options.manifest) {
          checkProbes(nitro, options.manifest)
        }
      })

      nitro.hooks.hook('types:extend', async () => {
        if (options.apiClient) {
          nitro.logger.debug('Generating C8Y API client')
          await writeAPIClient(nitro, options)
        }

        // TODO: extend types with manifest options (roles for auth etc.)
      })

      nitro.hooks.hook('close', async () => {
        // Build the Docker image
        await createC8yZip(nitro, options.zip)
      })
    },
  }
}

export default c8y
