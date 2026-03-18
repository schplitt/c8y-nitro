import { definePlugin } from 'nitro'
import { c8yManifest } from 'c8y-nitro/runtime'

export default definePlugin(async (nitroApp) => {
  nitroApp.hooks.hook('evlog:enrich', (enrichContext) => {
    enrichContext.event.microservice = {
      name: c8yManifest.name,
      version: c8yManifest.version,
      provider: c8yManifest.provider,
      contextPath: c8yManifest.contextPath,
    }
  })
})
