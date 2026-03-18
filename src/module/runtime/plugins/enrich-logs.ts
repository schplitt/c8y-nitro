import { definePlugin } from 'nitro'

export default definePlugin(async (nitroApp) => {
  const { c8yManifest } = await import('c8y-nitro/runtime')
  nitroApp.hooks.hook('evlog:enrich', (enrichContext) => {
    enrichContext.event.ms = {
      name: c8yManifest.name,
      version: c8yManifest.version,
      provider: c8yManifest.provider,
      contextPath: c8yManifest.contextPath,
    }
  })
})
