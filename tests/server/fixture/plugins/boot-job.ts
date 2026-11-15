import { definePlugin } from 'nitro'
import { tasks } from '../scheduler'

// Schedules a job at startup, as the scheduled-tasks guide recommends. A new
// service instance runs this again: the stopped instance's job must be gone,
// or scheduling throws "already exists".
export default definePlugin(() => {
  tasks.scheduleJob({ name: 'boot-job', task: 'log', payload: { marker: 'boot' }, schedule: { cron: '0 0 1 1 *' } })
})
