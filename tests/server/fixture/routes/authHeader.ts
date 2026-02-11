import { defineEventHandler } from 'nitro/h3'

export default defineEventHandler(async (event) => {
  // return back the auth header in this test
  return {
    authHeader: event.req.headers.get('authorization'),
  }
})
