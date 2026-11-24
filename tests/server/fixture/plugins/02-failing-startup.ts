import process from 'node:process'
import { definePlugin } from 'nitro'

// Fails the app start while the app is created, only when a test sets
// FIXTURE_FAIL_STARTUP (testing-realtime.test.ts).
export default definePlugin(() => {
  if (process.env.FIXTURE_FAIL_STARTUP) {
    throw new Error('fixture startup failure')
  }
})
