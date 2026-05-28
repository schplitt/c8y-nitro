import type { UserConfig } from 'tsdown'
import { defineConfig } from 'tsdown'
import ApiSnapshot from 'tsnapi/rolldown'

const mainConfig: UserConfig = {
  entry: {
    'index': './src/index.ts',
    'types': './src/types/index.ts',
    'utils': './src/utils/index.ts',
    'cli/index': './src/cli/index.ts',
  },
  target: ['es2023'],
  format: 'esm',
  clean: true,
  dts: true,
  outDir: './dist',
  failOnWarn: true,
  deps: {
    // '#nitro/virtual/tasks' is a virtual module injected by Nitro's bundler at
    // runtime — it does not exist as a real package and must not be bundled.
    neverBundle: ['c8y-nitro/runtime', 'nitro/runtime-config', '#nitro/virtual/tasks'],
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
    // DTS OFF!
    dts: false,
    exports: false,
  },
])
