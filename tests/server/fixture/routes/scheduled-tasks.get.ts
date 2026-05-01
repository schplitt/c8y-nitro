import { defineEventHandler } from 'nitro/h3'
import { listScheduledTasks } from 'c8y-nitro/utils'

export default defineEventHandler(async () => {
  return {
    pending: await listScheduledTasks(),
  }
})
