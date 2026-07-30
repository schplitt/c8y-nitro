import { defineEventHandler, getQuery } from 'nitro/h3'
import { tasks } from '../scheduler'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const marker = typeof query.marker === 'string' ? query.marker : 'default'

  const job = tasks.scheduleJob({
    name: `cancel-${marker}`,
    task: 'log',
    payload: { marker },
    schedule: { in: 1 },
  })
  const cancelled = tasks.cancelJob(`cancel-${marker}`)

  return {
    job,
    cancelled,
    jobs: tasks.listJobs(),
  }
})
