import { definePlugin } from 'nitro'
import { serviceCloses } from '../service-closes'

// Counts how often Nitro's `close` hook runs (testing-realtime.test.ts).
export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook('close', () => {
    serviceCloses.count++
  })
})
