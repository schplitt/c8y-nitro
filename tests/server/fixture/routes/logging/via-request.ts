import { defineHandler } from 'nitro/h3'
import { useRequest } from 'nitro/context'
import { useLogger } from 'c8y-nitro/utils'

// Exercises useLogger() with the ServerRequest from useRequest() (no H3Event),
// which requires experimental.asyncContext. Regression guard for the wrapper
// that lets useLogger accept both an H3Event and a ServerRequest.
export default defineHandler(() => {
  const log = useLogger(useRequest())

  log.set({ action: 'test-via-request', user: { id: 'user_789' } })

  return { message: 'ok', action: 'test-via-request' }
})
