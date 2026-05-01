import { defineTask } from 'nitro/task'
import { consola } from 'consola'

export default defineTask({
  meta: {
    name: 'scheduler:log',
    description: 'Log a scheduled task marker for integration tests',
  },
  run({ payload }) {
    consola.log(`scheduled-task:${String(payload.marker)}`)
    return { result: true }
  },
})