import type { UserConfig } from 'tsdown'
import { defineConfig } from 'tsdown'
import ApiSnapshot from 'tsnapi/rolldown'

const mainConfig: UserConfig = {
  entry: {
    'index': './src/index.ts',
    'types': './src/types/index.ts',
    'utils': './src/utils/index.ts',
    'cli/index': './src/cli/index.ts',
    'testing': './src/testing/index.ts',
    'testing/vite': './src/testing/vite.ts',
    'testing/setup': './src/testing/setup.ts',
  },
  target: ['es2023'],
  format: 'esm',
  // Both configs build in parallel into dist/: each one cleans only its own
  // output, otherwise one build can delete files the other just wrote.
  clean: ['dist/**', '!dist/runtime/**'],
  dts: true,
  outDir: './dist',
  failOnWarn: true,
  deps: {
    // c8y-nitro/utils: the testing setup file must share the module instance
    // (and caches) the server uses. vitest/vite: optional peers of the testing entry.
    neverBundle: ['c8y-nitro/runtime', 'nitro/runtime-config', 'c8y-nitro/utils', 'vitest', 'vite'],
  },

  globImport: true,
  plugins: [
    ApiSnapshot(),
  ],
  exports: true,
}

export default defineConfig([
  mainConfig,
  {
    // 2nd config for runtime code only
    ...mainConfig,
    // separate config for runtime code
    entry: {
      'runtime/*': './src/module/runtime/**/*.ts',
    },
    clean: ['dist/runtime/**'],
    // DTS OFF!
    dts: false,
    exports: false,
    // Runtime files that need shared module state (e.g. the tenant option
    // fetcher registry) import `c8y-nitro/utils`; keep it external so Nitro
    // bundles a single copy for user routes and runtime handlers.
    deps: {
      neverBundle: [...mainConfig.deps!.neverBundle as string[], 'c8y-nitro/utils'],
    },
  },
])
