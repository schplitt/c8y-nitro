import { defineHandler } from 'nitro/h3'
import { useLogger, createError } from 'c8y-nitro/utils'

export default defineHandler((event) => {
  const log = useLogger(event)

  log.set({ action: 'test-error', user: { id: 'user_456' } })

  throw createError({
    message: 'Something went wrong',
    status: 400,
    why: 'Test error occurred for logging verification',
    fix: 'This is a test fixture, nothing to fix',
    link: 'https://www.evlog.dev/core-concepts/structured-errors',
  })
})
