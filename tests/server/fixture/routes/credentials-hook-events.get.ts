import { defineEventHandler, getQuery } from 'nitro/h3'
import { clearCredentialHookEvents, getCredentialHookEvents } from '../plugins/tenant-credentials-updated'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const events = getCredentialHookEvents()

  if (query.clear === '1') {
    clearCredentialHookEvents()
  }

  return {
    events,
  }
})
