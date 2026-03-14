import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    'index': './src/index.ts',
    'types': './src/types/index.ts',
    'utils': './src/utils/index.ts',
    'cli/index': './src/cli/index.ts',
    'runtime/*': './src/module/runtime/**/*.ts',
  },
  target: ['es2023'],
  format: 'esm',
  clean: true,
  dts: true,
  outDir: './dist',
  failOnWarn: true,
  deps: {
    neverBundle: ['c8y-nitro/runtime', 'nitro/runtime-config'],
  },
})
