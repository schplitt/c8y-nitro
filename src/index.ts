import type { NitroModule } from 'nitro/types'
import type { C8YAPIClientOptions, C8YManifestOptions } from './types'
import { setupRuntimeConfig } from './dev/env'
import { writeAPIClient } from './dev/apiClient'
import { createDockerImage } from './dev/docker'

export interface C8yNitroModuleOptions {
  manifest?: C8YManifestOptions
  apiClient?: C8YAPIClientOptions
}

export function c8y(options: C8yNitroModuleOptions = {}): NitroModule {
  return {
    name: 'c8y-nitro',
    setup: (nitro) => {
      nitro.logger.info('c8y-nitro coming soon...')

      setupRuntimeConfig(nitro)

      // setup preset
      nitro.options.preset = 'node-server'

      nitro.hooks.hook('types:extend', (types) => {
        if (options.apiClient) {
          nitro.logger.debug('Generating C8Y API client types')
          writeAPIClient(nitro, options.apiClient, types)
        } else {
          nitro.logger.debug('No API client options provided, skipping API client generation.')
        }

        // TODO: extend types with manifest options (roles for auth etc.)
      })

      nitro.hooks.hook('close', async () => {
        // Build the Docker image
        await createDockerImage(nitro)
      })
    },
  }
}

export default c8y
