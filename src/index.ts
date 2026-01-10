import type { NitroModule } from 'nitro/types'
import type { C8YAPIClientOptions, C8YManifestOptions } from './types'
import { setupRuntimeConfig } from './dev/env'
import { writeAPIClient } from './dev/apiClient'
import { createC8yZip } from './dev/c8yzip'
import type { C8YZipOptions } from './types/zip'
import { getServiceInfo } from './dev/manifest'
import { checkProbes, setupProbes } from './runtime/probes'

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

      nitro.hooks.hook('build:before', async () => {
        // Setup probes first, then check user-defined ones
        await setupProbes(nitro, options.manifest)

        if (options.manifest) {
          checkProbes(nitro, options.manifest)
        }
      })

      nitro.hooks.hook('types:extend', async (types) => {
        if (options.apiClient) {
          // Get service info from package.json and manifest options
          const serviceInfo = await getServiceInfo(nitro, options.manifest)

          if (!serviceInfo) {
            nitro.logger.warn('API client generation skipped: no service name found in package.json')
            return
          }

          const { serviceName, contextPath } = serviceInfo

          // Determine contextPath with fallback, always use serviceName for file/class name
          const serviceContextPath = options.apiClient.contextPath ?? contextPath
          const name = `${serviceName}APIClient`

          nitro.logger.debug(`Generating C8Y API client types (contextPath: ${serviceContextPath}, name: ${name})`)
          await writeAPIClient(nitro, options.apiClient, serviceContextPath, name, types)
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
