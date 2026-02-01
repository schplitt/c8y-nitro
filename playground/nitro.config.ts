import { defineNitroConfig } from 'nitro/config'
import c8y from 'c8y-nitro'

export default defineNitroConfig({
  preset: 'node_server',
  serverDir: './',

  builder: 'rolldown',

  experimental: {
    asyncContext: true,
  },

  c8y: {
    manifest: {
      roles: ['SOME_CUSTOM_ROLE', 'ANOTHER_ROLE'],
    },
    cache: {
      credentialsTTL: 400,
    },
  },

  modules: [
    c8y(),
  ],
})
