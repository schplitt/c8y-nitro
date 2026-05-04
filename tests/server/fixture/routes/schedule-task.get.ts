import { defineEventHandler, getQuery } from 'nitro/h3'
import { listScheduledTasks, scheduleTask } from 'c8y-nitro/utils'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const marker = typeof query.marker === 'string' ? query.marker : 'default'
  const schedule = typeof query.schedule === 'string' ? Number(query.schedule) : 0.1

  const scheduled = await scheduleTask('scheduler:log', {
    payload: { marker },
    schedule,
  })

  return {
    scheduled,
    pending: await listScheduledTasks(),
  }
})
