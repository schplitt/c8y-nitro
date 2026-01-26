import { defineEventHandler } from 'nitro/h3'

export default defineEventHandler(async () => {
  return {
    status: 'OK',
  }
})
