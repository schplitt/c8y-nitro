import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    'index': './src/index.ts',
    'types': './src/types/index.ts',
    'utils': './src/utils/index.ts',
    'cli/index': './src/cli/index.ts',
    'client': './src/client.ts',
  },
  target: ['es2023'],
  format: 'esm',
  clean: true,
  dts: true,
  outDir: './dist',
  unbundle: true,
  // necessary due to invalid esm exports from @c8y/client
  noExternal: ['@c8y/client'],
  copy: [
    {
      from: './src/module/runtime/**/*.ts',
      flatten: false,
    },
  ],
})
