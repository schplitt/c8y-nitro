import process from 'node:process'
import { definePlugin } from 'nitro'
import { serviceCloses } from '../service-closes'

// Makes Nitro's `close` hook of an app created while a test sets
// FIXTURE_SLOW_CLOSE take that many milliseconds (testing-realtime.test.ts).
export default definePlugin((nitroApp) => {
  const delay = Number(process.env.FIXTURE_SLOW_CLOSE ?? 0)
  nitroApp.hooks.hook('close', async () => {
    if (delay > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, delay)
      })
      serviceCloses.slowDone++
    }
  })
})
