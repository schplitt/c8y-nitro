import process from 'node:process'
import { definePlugin } from 'nitro'

// Throws in Nitro's `close` hook of an app created while a test sets
// FIXTURE_CLOSE_FAILS (testing-realtime.test.ts). Runs before
// 02-failing-startup.ts.
export default definePlugin((nitroApp) => {
  const fails = Boolean(process.env.FIXTURE_CLOSE_FAILS)
  nitroApp.hooks.hook('close', () => {
    if (fails) {
      throw new Error('fixture close failure')
    }
  })
})
