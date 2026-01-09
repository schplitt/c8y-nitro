import type { NitroModule } from 'nitro/types'
import type { C8YAPIClientOptions, C8YManifestOptions } from './types'
import { setupRuntimeConfig } from './dev/env'
import { writeAPIClient } from './dev/apiClient'
import { createC8yZip } from './dev/c8yzip'
import type { C8YZipOptions } from './types/zip'

export interface C8yNitroModuleOptions {
  manifest?: C8YManifestOptions
  apiClient?: C8YAPIClientOptions
  zip?: C8YZipOptions
}

export function c8y(options: C8yNitroModuleOptions = {}): NitroModule {
  return {
    name: 'c8y-nitro',
    setup: async (nitro) => {
      setupRuntimeConfig(nitro)

      // setup preset
      nitro.options.preset = 'node-server'

      // TODO: automatically inject "health" endpoint into server and manifest unless overwritten

      nitro.hooks.hook('types:extend', async (types) => {
        if (options.apiClient) {
          nitro.logger.debug('Generating C8Y API client types')
          // TODO: pass manifest options to generate correct context path
          await writeAPIClient(nitro, options.apiClient, types)
        } else {
          nitro.logger.debug('No API client options provided, skipping API client generation.')
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
