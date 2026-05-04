import { defineTask } from 'nitro/task'

export default defineTask({
  meta: {
    name: 'scheduler:log',
    description: 'Log a scheduled task marker for integration tests',
  },
  run({ payload }) {
    // eslint-disable-next-line no-console
    console.log(`scheduled-task:${String(payload.marker)}`)
    return { result: true }
  },
})
