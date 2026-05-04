import { ms } from 'itty-time'
import type { TaskContext, TaskPayload } from 'nitro/types'
import { randomUUID } from 'node:crypto'
import { runTask } from 'nitro/task'

const MAX_TIMEOUT_MS = 2_147_483_647
const SCHEDULE_LOOKAHEAD_MS = 60 * 60 * 1000
const SCHEDULER_TICK_MS = 100

export type ScheduledTaskPayload = TaskPayload
export type ScheduledTaskContext = TaskContext
/**
 * A one-shot schedule definition for `scheduleTask()`.\
 * Numbers are treated as seconds from now, strings are parsed as human-readable durations
 * such as `"10 minutes"`, and dates are used as exact run times.
 */
export type ScheduledTaskInput = Date | number | string

/**
 * Options for scheduling a Nitro task to run once in the future.\
 * `payload` and `context` are passed through to Nitro's `runTask()` when the task starts.
 */
export interface ScheduleTaskOptions {
  /**
   * Payload passed to Nitro's `runTask()` call.
   */
  payload?: ScheduledTaskPayload
  /**
   * Context passed to Nitro's `runTask()` call.
   */
  context?: ScheduledTaskContext
  /**
   * When the task should run. Numbers are seconds from now.
   */
  schedule: ScheduledTaskInput
}

/**
 * Public information about a pending scheduled task.\
 * Returned by `scheduleTask()` and by `listScheduledTasks()`.
 */
export interface ScheduledTaskInfo {
  /**
   * Stable UUID used to list or cancel the scheduled task.
   */
  id: string
  /**
   * Nitro task name that will be passed to `runTask()`.
   */
  task: string
  /**
   * Exact execution time as an ISO date string.
   */
  runAt: string
}

interface ScheduledTaskRecord {
  id: string
  taskName: string
  payload: ScheduledTaskPayload
  context: ScheduledTaskContext
  runAt: number
  timeoutId?: number
}

// TODO: Add persisted scheduler state when inventory-backed scheduling is implemented.
const scheduledTasks = new Map<string, ScheduledTaskRecord>()
const scheduledTaskTimers = new Map<number, ReturnType<typeof setTimeout>>()
const schedulerReady: Promise<void> = Promise.resolve()
let schedulerInterval: ReturnType<typeof setInterval> | undefined

function createScheduledTaskId(): string {
  return randomUUID()
}

function resolveScheduleTime(schedule: ScheduledTaskInput): number {
  if (schedule instanceof Date) {
    const timestamp = schedule.getTime()
    if (Number.isNaN(timestamp)) {
      throw new TypeError('schedule date must be valid')
    }
    return timestamp
  }

  if (typeof schedule === 'number') {
    if (!Number.isFinite(schedule) || schedule < 0) {
      throw new TypeError('schedule number must be a non-negative number of seconds')
    }
    return Date.now() + (schedule * 1000)
  }

  const delay = ms(schedule)
  if (!Number.isFinite(delay) || delay < 0) {
    throw new TypeError('schedule string must be a valid non-negative duration')
  }

  return Date.now() + delay
}

async function executeScheduledTask(id: string): Promise<void> {
  const record = scheduledTasks.get(id)
  if (!record) {
    return
  }

  if (record.timeoutId !== undefined) {
    scheduledTaskTimers.delete(record.timeoutId)
  }

  scheduledTasks.delete(id)
  stopSchedulerIntervalIfIdle()

  await runTask(record.taskName, {
    payload: record.payload,
    context: record.context,
  })
}

function armScheduledTaskTimeout(id: string): void {
  const record = scheduledTasks.get(id)
  if (!record || record.timeoutId !== undefined) {
    return
  }

  const remainingMs = Math.max(record.runAt - Date.now(), 0)
  if (remainingMs > SCHEDULE_LOOKAHEAD_MS) {
    return
  }

  const delayMs = Math.min(remainingMs, MAX_TIMEOUT_MS)

  const timeout = setTimeout(() => {
    executeScheduledTask(id)
  }, delayMs)

  record.timeoutId = Number(timeout)
  scheduledTaskTimers.set(record.timeoutId, timeout)
}

function runSchedulerTick(): void {
  for (const record of scheduledTasks.values()) {
    armScheduledTaskTimeout(record.id)
  }
}

function ensureSchedulerInterval(): void {
  if (schedulerInterval) {
    return
  }

  schedulerInterval = setInterval(runSchedulerTick, SCHEDULER_TICK_MS)
}

function stopSchedulerIntervalIfIdle(): void {
  if (!schedulerInterval || scheduledTasks.size > 0) {
    return
  }

  clearInterval(schedulerInterval)
  schedulerInterval = undefined
}

/**
 * Schedules a Nitro task to run once in the future.\
 * Uses Nitro's `runTask()` internally when the scheduled time is reached.\
 * Numbers are treated as seconds, strings are parsed as human-readable durations, and dates are used as exact run times.
 *
 * @param taskName - The Nitro task name to run
 * @param options - Nitro task options plus the schedule time
 * @returns Information about the scheduled task
 *
 * @example
 * // Run a task in 30 seconds:
 * const scheduled = await scheduleTask('emails:send', {
 *   payload: { messageId: 'abc123' },
 *   schedule: 30,
 * })
 *
 * @example
 * // Run a task using a human-readable duration:
 * await scheduleTask('reports:generate', {
 *   payload: { reportId: 'report-1' },
 *   schedule: '1 hour',
 * })
 *
 * @example
 * // Run a task at an exact time:
 * await scheduleTask('cleanup:tenant', {
 *   payload: { tenant: 't12345' },
 *   schedule: new Date('2026-05-01T12:00:00Z'),
 * })
 */
export async function scheduleTask(taskName: string, options: ScheduleTaskOptions): Promise<ScheduledTaskInfo> {
  await schedulerReady

  if (!taskName) {
    throw new TypeError('taskName is required')
  }

  const runAt = resolveScheduleTime(options.schedule)
  const record: ScheduledTaskRecord = {
    id: createScheduledTaskId(),
    taskName,
    payload: options.payload ?? {},
    context: options.context ?? {},
    runAt,
  }

  scheduledTasks.set(record.id, record)
  armScheduledTaskTimeout(record.id)
  ensureSchedulerInterval()

  return {
    id: record.id,
    task: record.taskName,
    runAt: new Date(record.runAt).toISOString(),
  }
}

/**
 * Lists all tasks that are currently scheduled and have not started yet.\
 * The returned object is keyed by the scheduled task UUID for easy lookup and cancellation.
 *
 * @returns Object mapping scheduled task IDs to their public task information
 *
 * @example
 * const tasks = await listScheduledTasks()
 * for (const [id, task] of Object.entries(tasks)) {
 *   console.log(id, task.task, task.runAt)
 * }
 */
export async function listScheduledTasks(): Promise<Record<string, ScheduledTaskInfo>> {
  await schedulerReady

  return Object.fromEntries(
    [...scheduledTasks.values()].map((record) => [
      record.id,
      {
        id: record.id,
        task: record.taskName,
        runAt: new Date(record.runAt).toISOString(),
      },
    ]),
  )
}

/**
 * Cancels a scheduled task before it starts running.\
 * Once the underlying Nitro task has started, it cannot be cancelled with this utility.
 *
 * @param id - The scheduled task UUID returned by `scheduleTask()` or `listScheduledTasks()`
 * @returns `true` when a pending task was cancelled, otherwise `false`
 *
 * @example
 * const scheduled = await scheduleTask('emails:send', {
 *   payload: { messageId: 'abc123' },
 *   schedule: '10 minutes',
 * })
 *
 * const cancelled = await cancelScheduledTask(scheduled.id)
 */
export async function cancelScheduledTask(id: string): Promise<boolean> {
  await schedulerReady

  const record = scheduledTasks.get(id)
  if (!record) {
    return false
  }

  if (record.timeoutId !== undefined) {
    const timeout = scheduledTaskTimers.get(record.timeoutId)
    if (timeout) {
      clearTimeout(timeout)
      scheduledTaskTimers.delete(record.timeoutId)
    }
  }

  const cancelled = scheduledTasks.delete(id)
  stopSchedulerIntervalIfIdle()
  return cancelled
}
