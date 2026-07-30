import { defineEventHandler, getQuery } from 'nitro/h3'
import { tasks } from '../scheduler'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const marker = typeof query.marker === 'string' ? query.marker : 'default'
  const seconds = typeof query.schedule === 'string' ? Number(query.schedule) : 0.1

  const job = tasks.scheduleJob({
    name: `log-${marker}`,
    task: 'log',
    payload: { marker },
    schedule: { in: seconds },
  })

  return {
    job,
    jobs: tasks.listJobs(),
  }
})
