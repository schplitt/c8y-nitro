/* eslint-disable @typescript-eslint/no-empty-object-type */
import type { TaskContext, TaskPayload } from 'nitro/types'
import { Cron } from 'croner'
import { ms } from 'itty-time'

/**
 * Concurrency policy for a single job.
 * - `'single'`: at most one run of the job is in flight at a time. A tick that
 *   fires while the previous run is still going is skipped, and a manual
 *   {@link TaskRegistry.triggerJob} while a run is active joins the in-flight run.
 * - `'parallel'`: every tick (or trigger) starts a fresh run, even if a previous
 *   run has not finished. Runs of the same job may overlap.
 */
export type JobConcurrency = 'single' | 'parallel'

export type TaskRegistryPayload = TaskPayload
export type TaskRegistryContext = TaskContext

/**
 * The event passed to a task handler on every execution.
 */
export interface TaskEvent<TPayload = TaskRegistryPayload> {
  /**
   * Name of the task (function) being executed.
   */
  task: string
  /**
   * Name of the job that triggered this run, when the run originates from a scheduled or triggered job.
   */
  job?: string
  /**
   * Data bound when the job was scheduled (or passed to `run()`/`triggerJob()`).
   */
  payload: TPayload
  /**
   * Arbitrary context bound alongside the payload.
   */
  context: TaskRegistryContext
}

/**
 * A task handler function registered via {@link TaskRegistry.createTask}.
 */
export type TaskHandler<TPayload = TaskRegistryPayload, TResult = unknown>
  = (event: TaskEvent<TPayload>) => TResult | Promise<TResult>

/**
 * When a job should run.
 * - `{ cron }`: recurring on a cron expression. 5- or 6-field (with seconds) is
 *   supported. Evaluated in UTC by default, or in the job's `timezone` if set.
 * - `{ in }`: one-shot, from now — either a number of seconds (`{ in: 30 }`) or a
 *   human duration string (`{ in: '5 minutes' }`, `{ in: '1 hour' }`).
 * - `{ at }`: one-shot, at an exact instant given as a `Date` or ISO 8601 string,
 *   taken literally (never re-projected to another timezone). Times in the past
 *   fire almost immediately.
 */
export type JobSchedule
  = | { cron: string }
    | { in: number | string }
    | { at: Date | string }

/**
 * Options for scheduling a job via {@link TaskRegistry.scheduleJob}.
 */
export interface ScheduleJobOptions<
  TTask extends string = string,
  TPayload = TaskRegistryPayload,
  TSchedule extends JobSchedule = JobSchedule,
> {
  /**
   * Unique, caller-chosen job name. This is the handle used by `cancelJob()`, `getJob()` and `triggerJob()`.
   */
  name: string
  /**
   * Name of a task registered via `createTask()` that this job runs.
   */
  task: TTask
  /**
   * When the job should run.
   */
  schedule: TSchedule
  /**
   * Data forwarded to the handler's `event.payload`.\
   * Prefer stable identifiers (e.g. a config id) over live object references so the
   * handler can resolve current values at run time and the schedule stays serializable.
   */
  payload?: TPayload
  /**
   * Data forwarded to the handler's `event.context`.
   */
  context?: TaskRegistryContext
  /**
   * Concurrency policy for this job. Defaults to `'single'`.
   */
  concurrency?: JobConcurrency
  /**
   * Recurring only: the IANA timezone the cron expression is evaluated in
   * (e.g. `'Europe/Berlin'`). Defaults to `'UTC'` so the schedule is deterministic
   * regardless of the container's local time. croner performs the alignment — no
   * conversion is done by `c8y-nitro`. Ignored for one-shot schedules.
   */
  timezone?: string
  /**
   * Recurring only: also run once immediately on registration, in addition to the cron. Defaults to `false`.
   */
  immediate?: boolean
  /**
   * Recurring only: stop after this many scheduled runs.
   */
  maxRuns?: number
  /**
   * Overwrite an existing job with the same name instead of throwing. Defaults to `false`.
   */
  replace?: boolean
}

/**
 * Fields common to every job, regardless of kind.
 */
export interface BaseJobInfo {
  /**
   * The job's unique name.
   */
  name: string
  /**
   * The task (function) the job runs.
   */
  task: string
  /**
   * The job's concurrency policy.
   */
  concurrency: JobConcurrency
  /**
   * Next scheduled execution as an ISO datetime string, or `null` if nothing is pending.
   */
  nextRun: string | null
  /**
   * Whether a run of this job is currently in flight.
   */
  running: boolean
}

/**
 * Information about a one-shot job (scheduled with `{ in }` or `{ at }`).
 */
export interface OnceJobInfo extends BaseJobInfo {
  kind: 'once'
  /**
   * Always `null` for one-shot jobs.
   */
  cron: null
}

/**
 * Information about a recurring job (scheduled with `{ cron }`).
 */
export interface RecurringJobInfo extends BaseJobInfo {
  kind: 'recurring'
  /**
   * The cron expression the job runs on.
   */
  cron: string
  /**
   * The IANA timezone the cron expression is evaluated in.
   */
  timezone: string
  /**
   * A few upcoming executions as ISO datetime strings.
   */
  nextRuns: string[]
}

/**
 * Public information about a registered job. A discriminated union on `kind` —
 * returned by `scheduleJob()`, `getJob()` and `listJobs()`.
 */
export type JobInfo = OnceJobInfo | RecurringJobInfo

/**
 * Maps a {@link JobSchedule} to the {@link JobInfo} variant it produces.
 */
export type JobInfoFor<TSchedule extends JobSchedule> = TSchedule extends { cron: string }
  ? RecurringJobInfo
  : OnceJobInfo

interface TaskDefinition {
  name: string
  handler: TaskHandler<any, any>
}

interface JobRecord {
  name: string
  task: string
  kind: 'once' | 'recurring'
  concurrency: JobConcurrency
  cronExpr: string | null
  timezone: string
  payload: TaskRegistryPayload
  context: TaskRegistryContext
  cron: Cron
  inFlight?: Promise<unknown>
}

/**
 * Describes the payload and result type of a single registered task.
 */
export interface TaskShape<TPayload = TaskRegistryPayload, TResult = unknown> {
  payload: TPayload
  result: TResult
}

/**
 * A map of task name to its {@link TaskShape}, accumulated by the builder.
 */
export type TaskMap = Record<string, TaskShape>

/**
 * A type-charged registry of tasks (functions) and the jobs that schedule them.
 *
 * Each `createTask()` call widens the registry's type with the new task name, so
 * `run()`, `scheduleJob()` and `triggerJob()` autocomplete known task names and
 * reject typos at compile time.
 */
export interface TaskRegistry<TTasks extends TaskMap = {}> {
  /**
   * Registers a task (function) under a compile-time-known name.\
   * Passing a name that is already registered is a type error (and throws at runtime).
   *
   * @param name - Unique task name
   * @param handler - The function to run. Annotate its event to type the payload,
   * e.g. `(e: TaskEvent<{ configId: string }>) => ...`.
   */
  createTask: <TName extends string, TPayload extends TaskRegistryPayload = TaskRegistryPayload, TResult = unknown>(
    name: TName extends keyof TTasks ? never : TName,
    handler: TaskHandler<TPayload, TResult>,
  ) => TaskRegistry<TTasks & Record<TName, TaskShape<TPayload, TResult>>>

  /**
   * Runs a task immediately and ad-hoc, without registering a job. Always runs
   * fresh (no deduplication). Use a job with `'single'` concurrency when you need
   * overlap protection.
   */
  run: <TName extends keyof TTasks & string>(
    task: TName,
    options?: { payload?: TTasks[TName]['payload'], context?: TaskRegistryContext },
  ) => Promise<TTasks[TName]['result']>

  /**
   * Schedules a named job that runs a task once or repeatedly. The return type is
   * inferred from the schedule: `{ cron }` yields a {@link RecurringJobInfo},
   * `{ in }`/`{ at }` yield a {@link OnceJobInfo}.
   */
  scheduleJob: <TName extends keyof TTasks & string, TSchedule extends JobSchedule>(
    options: ScheduleJobOptions<TName, TTasks[TName]['payload'], TSchedule>,
  ) => JobInfoFor<TSchedule>

  /**
   * Runs an already-registered job immediately, respecting its concurrency policy.
   * For a `'single'` job with a run in flight this returns the in-flight promise.
   */
  triggerJob: <TResult = unknown>(
    name: string,
    options?: { payload?: TaskRegistryPayload, context?: TaskRegistryContext },
  ) => Promise<TResult>

  /**
   * Cancels a scheduled job by name.
   * @returns `true` when a job was found and cancelled, otherwise `false`.
   */
  cancelJob: (name: string) => boolean

  /**
   * Lists all currently registered jobs.
   */
  listJobs: () => JobInfo[]

  /**
   * Returns information about a single job, or `undefined` if it does not exist.
   */
  getJob: (name: string) => JobInfo | undefined

  /**
   * Returns `true` when a task with the given name is registered.
   */
  hasTask: (name: string) => boolean
}

function resolveOnceDate(schedule: { in: number | string } | { at: Date | string }): Date {
  if ('in' in schedule) {
    // String → human duration (e.g. "5 minutes"); number → seconds from now.
    if (typeof schedule.in === 'string') {
      const delay = ms(schedule.in)
      if (!Number.isFinite(delay) || delay < 0) {
        throw new TypeError(`schedule.in must be a valid duration string (e.g. "5 minutes"), got "${schedule.in}"`)
      }
      return new Date(Date.now() + delay)
    }
    if (!Number.isFinite(schedule.in) || schedule.in < 0) {
      throw new TypeError('schedule.in must be a non-negative number of seconds')
    }
    return new Date(Date.now() + (schedule.in * 1000))
  }

  const date = schedule.at instanceof Date ? schedule.at : new Date(schedule.at)
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('schedule.at must be a valid Date or ISO 8601 string')
  }
  return date
}

/**
 * Creates a new, empty task registry.
 *
 * @example
 * import { c8yTasks } from 'c8y-nitro/utils'
 *
 * export const tasks = c8yTasks()
 *   .createTask('sync', async ({ payload }) => {
 *     const config = await loadConfig(payload.configId) // resolve live state here
 *     await sync(config)
 *   })
 *
 * // one per config, each an independent job
 * tasks.scheduleJob({ name: 'sync-abc', task: 'sync', payload: { configId: 'abc' }, schedule: { cron: '*\/5 * * * *' } })
 * tasks.scheduleJob({ name: 'sync-def', task: 'sync', payload: { configId: 'def' }, schedule: { cron: '*\/5 * * * *' }, concurrency: 'parallel' })
 *
 * @remarks
 * The registry is a plain runtime singleton — export it from one module and import
 * it wherever you schedule or cancel jobs. Recurring jobs only arm when the module
 * that schedules them executes, so register them from a Nitro plugin (or another
 * startup path) if they must run from boot.
 */
export function c8yTasks(): TaskRegistry {
  const tasks = new Map<string, TaskDefinition>()
  const jobs = new Map<string, JobRecord>()

  function execute(
    record: JobRecord,
    override?: { payload?: TaskRegistryPayload, context?: TaskRegistryContext },
  ): Promise<unknown> {
    const definition = tasks.get(record.task)
    if (!definition) {
      return Promise.reject(new Error(`Task "${record.task}" is not registered`))
    }

    if (record.concurrency === 'single' && record.inFlight) {
      return record.inFlight
    }

    const event: TaskEvent = {
      task: record.task,
      job: record.name,
      payload: override?.payload ?? record.payload,
      context: override?.context ?? record.context,
    }

    const promise = (async () => definition.handler(event))()

    if (record.concurrency === 'single') {
      record.inFlight = promise
      promise.finally(() => {
        if (record.inFlight === promise) {
          record.inFlight = undefined
        }
      })
    }

    return promise
  }

  function toJobInfo(record: JobRecord): JobInfo {
    const next = record.cron.nextRun()
    const base: BaseJobInfo = {
      name: record.name,
      task: record.task,
      concurrency: record.concurrency,
      nextRun: next ? next.toISOString() : null,
      running: record.inFlight !== undefined,
    }

    if (record.kind === 'recurring') {
      return {
        ...base,
        kind: 'recurring',
        cron: record.cronExpr as string,
        timezone: record.timezone,
        nextRuns: record.cron.nextRuns(3).map((date) => date.toISOString()),
      }
    }

    return { ...base, kind: 'once', cron: null }
  }

  function cancelJob(name: string): boolean {
    const record = jobs.get(name)
    if (!record) {
      return false
    }
    record.cron.stop()
    return jobs.delete(name)
  }

  const api: TaskRegistry<any> = {
    createTask(name, handler) {
      if (typeof name !== 'string' || !name) {
        throw new TypeError('task name is required')
      }
      if (tasks.has(name)) {
        throw new Error(`Task "${name}" is already registered`)
      }
      tasks.set(name, { name, handler: handler as TaskHandler })
      return api as any
    },

    async run(task, options) {
      const definition = tasks.get(task)
      if (!definition) {
        throw new Error(`Task "${task}" is not registered`)
      }
      return definition.handler({
        task,
        payload: options?.payload ?? {},
        context: options?.context ?? {},
      })
    },

    scheduleJob(options) {
      const { name, task, schedule, concurrency = 'single', replace = false } = options

      if (!name) {
        throw new TypeError('job name is required')
      }
      if (!tasks.has(task)) {
        throw new Error(`Task "${task}" is not registered. Register it with createTask() first.`)
      }
      if (jobs.has(name)) {
        if (!replace) {
          throw new Error(`Job "${name}" already exists. Pass { replace: true } to overwrite it.`)
        }
        cancelJob(name)
      }

      const isRecurring = 'cron' in schedule
      const timezone = options.timezone ?? 'UTC'

      const record: JobRecord = {
        name,
        task,
        kind: isRecurring ? 'recurring' : 'once',
        concurrency,
        cronExpr: isRecurring ? schedule.cron : null,
        timezone,
        payload: options.payload ?? {},
        context: options.context ?? {},
        // Assigned right below; Cron requires the callback which closes over `record`.
        cron: undefined as unknown as Cron,
      }

      const callback = (): void => {
        Promise.resolve(execute(record))
          .catch((error) => {
            console.error(`c8y-nitro: job "${name}" (task "${task}") failed`, error)
          })
          .finally(() => {
            // Clean up one-shot jobs and recurring jobs that have exhausted maxRuns.
            if (!record.cron.nextRun()) {
              jobs.delete(name)
            }
          })
      }

      if (isRecurring) {
        const cronOptions: { timezone: string, maxRuns?: number } = { timezone }
        if (typeof options.maxRuns === 'number') {
          cronOptions.maxRuns = options.maxRuns
        }
        record.cron = new Cron(schedule.cron, cronOptions, callback)
      } else {
        // Clamp past/near-immediate times slightly into the future so croner arms
        // the timer instead of treating them as already elapsed.
        const fireAt = Math.max(resolveOnceDate(schedule).getTime(), Date.now() + 50)
        record.cron = new Cron(new Date(fireAt), { maxRuns: 1 }, callback)
      }

      jobs.set(name, record)

      if (isRecurring && options.immediate) {
        Promise.resolve(execute(record)).catch((error) => {
          console.error(`c8y-nitro: job "${name}" immediate run failed`, error)
        })
      }

      // The public signature narrows the return type from the schedule; the
      // runtime shape is produced by toJobInfo().
      return toJobInfo(record) as any
    },

    triggerJob(name, options) {
      const record = jobs.get(name)
      if (!record) {
        throw new Error(`Job "${name}" is not registered`)
      }
      return execute(record, options) as Promise<any>
    },

    cancelJob,

    listJobs() {
      return [...jobs.values()].map(toJobInfo)
    },

    getJob(name) {
      const record = jobs.get(name)
      return record ? toJobInfo(record) : undefined
    },

    hasTask(name) {
      return tasks.has(name)
    },
  }

  return api as TaskRegistry
}
