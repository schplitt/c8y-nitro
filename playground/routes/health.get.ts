import { defineEventHandler } from 'nitro/h3'

export default defineEventHandler(() => {
  return {
    status: 'UP',
    timestamp: new Date().toISOString(),
  }
})
