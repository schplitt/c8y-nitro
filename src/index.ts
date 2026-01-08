import type { NitroModule } from 'nitro/types'
import type { C8YAPIClientOptions, C8YManifestOptions } from './types'
import { setupRuntimeConfig } from './utils/env'
import { writeAPIClient } from './utils/apiClient'

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
      })

      nitro.hooks.hook('compiled', (nitro) => {
        nitro.logger.info('🔵 Hook: compiled')
        nitro.logger.info(`output server dir is: ${nitro.options.output.serverDir}`)
      })
    },
  }
}

export default c8y
