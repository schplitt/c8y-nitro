import { defineTask } from 'nitro/task'

/**
 * Fixture task used to verify parallel execution of same-named tasks.\
 * Sleeps for `payload.sleepMs` milliseconds then logs `sleep-log:<marker>` so
 * the test can assert both invocations completed independently.
 */
export default defineTask({
  meta: {
    name: 'scheduler:sleep-log',
    description: 'Sleep then log a marker — used to verify parallel task execution',
  },
  async run({ payload }) {
    const sleepMs = typeof payload.sleepMs === 'number' ? payload.sleepMs : 100
    const marker = typeof payload.marker === 'string' ? payload.marker : 'default'

    await new Promise<void>((resolve) => {
      setTimeout(resolve, sleepMs)
    })
    // eslint-disable-next-line no-console
    console.log(`sleep-log:${marker}`)
    return { result: true }
  },
})
