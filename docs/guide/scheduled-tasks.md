# Tasks & Scheduling

`c8y-nitro` ships its own task registry for **runtime** scheduling: register functions once, then schedule named jobs that run them immediately, once in the future, or repeatedly on a cron — all decided at runtime.

It does not use (or require) Nitro's task system. For schedules that are fixed and known at build time, use Nitro's native [`scheduledTasks`](https://nitro.build/guide/tasks#scheduled-tasks) config instead — `c8y-nitro` intentionally owns only the dynamic, runtime-decided case.

## Mental model

There are two concepts:

- **Task** — a function, known at compile time, registered once via `createTask()`. Constant and typed.
- **Job** — a named, scheduled instance of a task. Its name is chosen at runtime, and it carries its own payload, schedule, and concurrency policy. The same task can back many jobs.

## Create a registry

`c8yTasks()` returns a type-charged registry. Each `createTask()` widens its type with the new task name, so `run()`, `scheduleJob()` and friends autocomplete task names and reject typos.

```ts
// server/tasks.ts
import type { TaskEvent } from 'c8y-nitro/utils'
import { c8yTasks } from 'c8y-nitro/utils'

export const tasks = c8yTasks()
  .createTask('sync', async (event: TaskEvent<{ configId: string }>) => {
    // Resolve current state at run time from the id in the payload.
    const config = await loadConfig(event.payload.configId)
    await sync(config)
  })
  .createTask('heartbeat', async () => {
    await ping()
  })
```

Annotate the handler's event (`TaskEvent<{ configId: string }>`) to type the payload — `scheduleJob()` and `run()` then type-check the payload you pass.

The registry is a plain runtime singleton: export it from one module and import it wherever you schedule or cancel jobs. Recurring jobs only arm when the module that schedules them executes, so register them from a Nitro plugin (or another startup path) if they must run from boot.

## Run a task now

`run()` executes a task immediately and ad-hoc, without registering a job. It always runs fresh.

```ts
import { tasks } from '../tasks'

await tasks.run('heartbeat')
await tasks.run('sync', { payload: { configId: 'abc' } })
```

## Schedule a job

`scheduleJob()` registers a named job. The `schedule` decides how it runs:

| Schedule              | Meaning                                                             |
| --------------------- | ------------------------------------------------------------------- |
| `{ in: 30 }`          | Once, 30 seconds from now                                           |
| `{ at: Date \| ISO }` | Once, at an exact instant (taken literally, no timezone conversion) |
| `{ cron: '...' }`     | Recurring on a 5- or 6-field cron expression                        |

```ts
import { tasks } from '../tasks'

// one recurring job per config — independent, each with its own payload
tasks.scheduleJob({
  name: 'sync-abc',
  task: 'sync',
  payload: { configId: 'abc' },
  schedule: { cron: '*/5 * * * *' },
})

// run once, later
tasks.scheduleJob({
  name: 'cleanup-run',
  task: 'sync',
  payload: { configId: 'def' },
  schedule: { in: 300 },
})
```

Cron expressions are evaluated in **UTC by default**, so the schedule is deterministic no matter where the container runs. Pass a `timezone` (any IANA zone) to align a recurring job to a specific wall clock — croner's engine does the alignment; `c8y-nitro` performs no conversion of its own:

```ts
tasks.scheduleJob({
  name: 'nightly-report',
  task: 'sync',
  payload: { configId: 'abc' },
  schedule: { cron: '0 2 * * *' }, // 02:00 …
  timezone: 'Europe/Berlin', // … Berlin time
})
```

For one-shot jobs, use an ISO 8601 string with an offset or `Z` (e.g. `2026-01-01T00:00:00Z`) to name an exact instant. Times in the past (for `at`/`in`) fire almost immediately.

### Payloads: pass ids, not live objects

Put stable identifiers (like a `configId`) in the payload and resolve the current values inside the handler. This keeps schedules serializable and ensures each run acts on today's data rather than a snapshot captured when the job was scheduled.

## Concurrency

Each job declares how overlapping runs behave via `concurrency` (default `'single'`):

- **`'single'`** — at most one run of the job at a time. A tick that fires while the previous run is still going is skipped; a manual `triggerJob()` while a run is active joins the in-flight run.
- **`'parallel'`** — every tick (or trigger) starts a fresh run, even if a previous run has not finished. Use this when a run may legitimately outlast the interval and you want them to overlap.

```ts
tasks.scheduleJob({
  name: 'sync-abc',
  task: 'sync',
  payload: { configId: 'abc' },
  schedule: { cron: '*/5 * * * *' },
  concurrency: 'parallel',
})
```

Distinct jobs are always independent of each other, regardless of concurrency — two jobs of the same task with different payloads run in parallel.

Recurring jobs also accept `immediate: true` (also run once on registration) and `maxRuns` (stop after N runs).

## Inspect, trigger, and cancel

```ts
import { tasks } from '../tasks'

tasks.listJobs() // all registered jobs
tasks.getJob('sync-abc') // one job, or undefined
tasks.triggerJob('sync-abc') // run an existing job now, respecting its concurrency
tasks.cancelJob('sync-abc') // true if a job was cancelled
```

`scheduleJob()` returns a discriminated `JobInfo`: recurring jobs expose `cron` and `nextRuns`, one-shot jobs have `cron: null`. Both carry `nextRun` (the next execution as an ISO string) and `running`. One-shot jobs remove themselves after they run.

## Replacing a job

Job names are unique. Scheduling a name that already exists throws unless you pass `replace: true`, which cancels the existing job first.

```ts
tasks.scheduleJob({ name: 'sync-abc', task: 'sync', payload: { configId: 'abc' }, schedule: { cron: '0 * * * *' }, replace: true })
```

## Important Limitation

Jobs live in process memory. They are not a durable queue: a restart or redeploy clears all scheduled jobs. For now, re-seed them yourself on startup (e.g. from a Nitro plugin that re-registers your recurring jobs). An automatic, inventory-backed persistence layer may be added later so schedules survive restarts without hand-rolling.
