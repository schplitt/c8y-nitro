import { defineEventHandler } from 'nitro/h3'
import { tasks } from '../scheduler'

export default defineEventHandler(() => {
  return {
    jobs: tasks.listJobs(),
  }
})
