import type { TaskEvent } from 'c8y-nitro/utils'
import { c8yTasks } from 'c8y-nitro/utils'

/**
 * Shared task registry for the scheduler integration tests. Routes import this
 * singleton and schedule jobs against it.
 */
export const tasks = c8yTasks()
  .createTask('log', (event: TaskEvent<{ marker?: string }>) => {
    // eslint-disable-next-line no-console
    console.log(`scheduled-task:${String(event.payload.marker)}`)
    return { result: true }
  })
  .createTask('sleep-log', async (event: TaskEvent<{ marker?: string, sleepMs?: number }>) => {
    const sleepMs = typeof event.payload.sleepMs === 'number' ? event.payload.sleepMs : 100
    const marker = typeof event.payload.marker === 'string' ? event.payload.marker : 'default'

    await new Promise<void>((resolve) => {
      setTimeout(resolve, sleepMs)
    })
    // eslint-disable-next-line no-console
    console.log(`sleep-log:${marker}`)
    return { result: true }
  })
