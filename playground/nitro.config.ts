import { defineNitroConfig } from 'nitro/config'
import c8y from 'c8y-nitro'

export default defineNitroConfig({
  preset: 'node_server',
  serverDir: './',

  experimental: {
    openAPI: true,
  },

  imports: {},

  modules: [
    c8y({
      apiClient: {
        dir: './src/generated',
        name: 'c8y-api-client',
        msBase: 'playground-service',
      },
    }),
  ],
})
