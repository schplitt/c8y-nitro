import { defineEventHandler, getQuery } from 'nitro/h3'
import { tasks } from '../scheduler'

/**
 * Schedules two independent jobs that run the same `sleep-log` task with
 * different payloads at overlapping times (1 s and 1.3 s from now, sleeping
 * 1 s and 0.7 s). Distinct jobs always run independently, so both must complete
 * with their own marker — this is what Nitro's name-only `runTask()` dedup could
 * not do.
 */
export default defineEventHandler((event) => {
  const query = getQuery(event)
  const marker = typeof query.marker === 'string' ? query.marker : 'default'

  const job1 = tasks.scheduleJob({
    name: `sleep-${marker}-1`,
    task: 'sleep-log',
    payload: { marker: `${marker}-1`, sleepMs: 1000 },
    schedule: { in: 1 },
  })
  const job2 = tasks.scheduleJob({
    name: `sleep-${marker}-2`,
    task: 'sleep-log',
    payload: { marker: `${marker}-2`, sleepMs: 700 },
    schedule: { in: 1.3 },
  })

  return { job1, job2 }
})
