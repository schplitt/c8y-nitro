import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
// Also adds Vitest's `configureVitest` hook and `test` config to Vite's types.
import type { ViteUserConfig } from 'vitest/config'
import type { C8yTestOptions } from './types'
import { DEFAULTS, PROVIDE_KEY } from './defaults'

export type { C8yTestOptions } from './types'

/**
 * Vite plugin that turns Nitro's Vitest environment into a fake Cumulocity
 * tenant. Add it next to `nitro()` in `vitest.config.ts`:
 *
 * - Requests of the real `@c8y/client` are answered in memory by the fake
 *   tenant behind `c8y` from `c8y-nitro/testing`. Nothing reaches the network.
 * - The `C8Y_*` dev and bootstrap env is set (existing `test.env` values win).
 * - Before every test, the tenant is reset to `options` and c8y-nitro's caches
 *   are cleared.
 *
 * @example
 * ```ts
 * import { nitro } from 'nitro/vite'
 * import { c8yTest } from 'c8y-nitro/testing/vite'
 * import { defineConfig } from 'vitest/config'
 *
 * export default defineConfig({
 *   plugins: [nitro(), c8yTest({ user: { userName: 'alice', roles: ['ROLE_ORDERS_READ'] } })],
 * })
 * ```
 * @param options - Baseline state of the fake tenant for every test
 */
export function c8yTest(options: C8yTestOptions = {}): Plugin {
  const setupFile = fileURLToPath(new URL('./setup.mjs', import.meta.url))
  const tenant = options.tenant ?? DEFAULTS.tenant
  const user = options.user === undefined ? DEFAULTS.user : options.user

  return {
    name: 'c8y-nitro:test',
    config(config) {
      const env: Record<string, string> = {
        C8Y_BASEURL: options.baseUrl ?? DEFAULTS.baseUrl,
        C8Y_BOOTSTRAP_TENANT: tenant,
        C8Y_BOOTSTRAP_USER: DEFAULTS.bootstrapUser,
        C8Y_BOOTSTRAP_PASSWORD: DEFAULTS.bootstrapPassword,
        C8Y_DEVELOPMENT_TENANT: user?.tenant ?? tenant,
        C8Y_DEVELOPMENT_USER: user?.userName ?? DEFAULTS.user.userName,
        C8Y_DEVELOPMENT_PASSWORD: DEFAULTS.developmentPassword,
      }
      const result: ViteUserConfig = {
        test: {
          setupFiles: [setupFile],
          env: { ...env, ...(config as ViteUserConfig).test?.env },
        },
      }
      return result
    },
    // Load the real @c8y/client with Node's own loader in the Nitro test
    // environment: Vite cannot transform its CommonJS dependencies (tslib,
    // cross-fetch), and the setup file must patch the same module instance the
    // server uses.
    configEnvironment(name) {
      return name === 'nitro' ? { resolve: { external: ['@c8y/client'] } } : undefined
    },
    configureVitest({ project }) {
      project.provide(PROVIDE_KEY, JSON.parse(JSON.stringify(options)))
    },
  }
}
