import { defineEventHandler, getQuery } from 'nitro/h3'
import { scheduleTask } from 'c8y-nitro/utils'

/**
 * Schedules two instances of `scheduler:sleep-log` with different markers at
 * overlapping times (2 s and 2.5 s from now, each sleeping 1 s) so the e2e test
 * can verify that both execute independently despite sharing the same task name.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const marker = typeof query.marker === 'string' ? query.marker : 'default'

  const [task1, task2] = await Promise.all([
    scheduleTask('scheduler:sleep-log', {
      payload: { marker: `${marker}-1`, sleepMs: 1000 },
      schedule: 1,
    }),
    scheduleTask('scheduler:sleep-log', {
      payload: { marker: `${marker}-2`, sleepMs: 700 },
      schedule: 1.3,
    }),
  ])

  return { task1, task2 }
})
