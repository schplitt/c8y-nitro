# Scheduled Tasks

The scheduler utilities add one-shot delayed execution on top of Nitro tasks.

Use them when a request should schedule work for later, but you do not need recurring cron behavior.

## Enable Nitro Tasks

```ts
export default defineNitroConfig({
  experimental: {
    tasks: true,
  },
  modules: [c8y()],
})
```

## Define a Task

Nitro derives task names from file paths. For example, `tasks/reports/generate.ts` becomes `reports:generate`.

```ts
import { defineTask } from 'nitro/task'

export default defineTask({
  meta: {
    name: 'reports:generate',
    description: 'Generate a report later',
  },
  run({ payload }) {
    return { reportId: payload.reportId }
  },
})
```

## Schedule Work

```ts
import { scheduleTask } from 'c8y-nitro/utils'

const scheduled = await scheduleTask('reports:generate', {
  payload: { reportId: 'report-1' },
  schedule: '1 hour',
})

console.log(scheduled.id, scheduled.runAt)
```

## Schedule Formats

The `schedule` value accepts:

| Type     | Meaning                                                             |
| -------- | ------------------------------------------------------------------- |
| `number` | Seconds from now                                                    |
| `string` | Human-readable duration parsed by `itty-time`, such as `10 minutes` |
| `Date`   | Exact run time                                                      |

Invalid dates, negative numbers, and invalid duration strings throw a `TypeError`.

## List and Cancel

```ts
import { cancelScheduledTask, listScheduledTasks } from 'c8y-nitro/utils'

const pending = await listScheduledTasks()
const cancelled = await cancelScheduledTask(scheduled.id)
```

`listScheduledTasks()` returns pending tasks keyed by their generated UUID.

`cancelScheduledTask()` returns `true` only when a pending task was found and cancelled. Once Nitro starts running the task, cancellation belongs to the task implementation, not to this scheduler.

## Important Limitation

Scheduled tasks are kept in process memory. They are useful for lightweight delayed work, but they are not a durable queue. A restart clears pending tasks.