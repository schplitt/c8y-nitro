import { defineHandler } from 'nitro/h3'
import { useLogger } from 'c8y-nitro/utils'

export default defineHandler((event) => {
  const log = useLogger(event)

  log.set({ action: 'test-success', user: { id: 'user_123' } })

  return { message: 'ok', action: 'test-success' }
})
