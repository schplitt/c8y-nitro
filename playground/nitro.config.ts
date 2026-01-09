import { defineNitroConfig } from 'nitro/config'
import c8y from 'c8y-nitro'

export default defineNitroConfig({
  preset: 'node_server',
  serverDir: './',

  experimental: {
    openAPI: true,
  },

  modules: [
    c8y({
      apiClient: {
        dir: './src/generated',
      },
    }),
  ],
})
