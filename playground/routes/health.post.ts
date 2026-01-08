import { defineEventHandler } from 'nitro/h3'

export default defineEventHandler(() => {
  return 'You posted to health check!'
})
