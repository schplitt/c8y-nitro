import type { NitroModule } from 'nitro/types'
import type { C8yNitroModuleOptions } from './types'
import { writeAPIClient } from './module/apiClient'
import { createC8yZip } from './module/c8yzip'
import { setupRuntime } from './module/runtime'
import { setupRuntimeConfig } from './module/runtimeConfig'
import { registerRuntime } from './module/registerRuntime'
import { checkProbes } from './module/probeCheck'
import { autoBootstrap } from './module/autoBootstrap'
import { name as pkgName } from '../package.json'
import evlog from 'evlog/nitro/v3'
import { createC8yManifestFromNitro } from './module/manifest'
import type { TenantCredentials } from './types/credentials'

declare module 'nitro/types' {
  interface NitroOptions {
    c8y?: C8yNitroModuleOptions
  }
}

declare module 'nitro/types' {
  interface NitroRuntimeHooks {
    'c8y:tenantCredentialsUpdated': (prev: TenantCredentials | null, next: TenantCredentials) => void
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
      //
      // tslib must be inlined too: if left external, the file tracer copies
      // tslib's `default` export condition (tslib.es6.mjs) while Node resolves
      // the `node` condition (modules/index.js) at runtime → ERR_MODULE_NOT_FOUND.
      // Inlining removes the runtime resolution step; the rolldown alias below
      // pins the inlined build to the ESM tslib.es6.mjs.
      nitro.options.noExternals = nitro.options.noExternals === true
        ? true
        : [
            ...(Array.isArray(nitro.options.noExternals) ? nitro.options.noExternals : []),
            pkgName,
            '@c8y/client',
            'tslib',
          ]

      // ensure correct tslib bundling
      nitro.options.rolldownConfig = {
        ...nitro.options.rolldownConfig,
        resolve: {
          ...nitro.options.rolldownConfig?.resolve,
          alias: {
            ...nitro.options.rolldownConfig?.resolve?.alias,
            tslib: 'tslib/tslib.es6.mjs',
          },
        },
      }

      // setup preset
      if (!nitro.options.preset.startsWith('nitro') && !nitro.options.preset.startsWith('node')) {
        nitro.logger.error(`Unsupported preset "${nitro.options.preset}" for c8y-nitro module, only node presets are supported.`)
        throw new Error('Unsupported preset for c8y-nitro module')
      }

      // setup evlog for logging in runtime
      let manifest = await createC8yManifestFromNitro(nitro)

      const { setup: setupEvlog } = evlog({
        env: {
          service: manifest.name,
        },
        exclude: [manifest.livenessProbe?.httpGet?.path, manifest.readinessProbe?.httpGet?.path].filter(Boolean) as string[],
      })

      await setupEvlog(nitro)

      // Auto-bootstrap and keep the dev tenant in sync with the local manifest.
      // Dev-only: it writes bootstrap credentials to .env and mutates the tenant,
      // which must not happen during a production build.
      const isNitroDev = nitro.options.preset === 'nitro-dev'
      if (isNitroDev && !options.skipBootstrap) {
        await autoBootstrap(nitro)
      }

      await setupRuntimeConfig(nitro, options)

      setupRuntime(nitro, manifest)

      nitro.hooks.hook('dev:reload', async () => {
        manifest = await createC8yManifestFromNitro(nitro)
        setupRuntime(nitro, manifest)
        // Re-sync the tenant on in-session manifest edits, not just full restarts.
        if (!options.skipBootstrap) {
          await autoBootstrap(nitro)
        }
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
