import type { OnceJobInfo, RecurringJobInfo, TaskEvent } from 'c8y-nitro/utils'
import { c8yTasks } from 'c8y-nitro/utils'

/**
 * Compile-time (type-level) tests for the task registry API.
 *
 * This file is type-checked by `tsc --noEmit` but is not executed by the runtime
 * test suite (its name does not match the vitest `*.test.ts` glob). Each
 * `@ts-expect-error` asserts the following line *must* be a type error, so the
 * guarantees can't silently regress.
 */

// Asserts `T` is exactly `Expected` (both directions).
type Expect<T, Expected> = [T] extends [Expected] ? ([Expected] extends [T] ? true : never) : never

export function taskRegistryTypeChecks() {
  const tasks = c8yTasks()
    .createTask('sync', (event: TaskEvent<{ configId: string }>) => ({ synced: event.payload.configId }))
    .createTask('heartbeat', () => 'ok')

  // Known task names are accepted.
  const recurring = tasks.scheduleJob({ name: 'sync-abc', task: 'sync', payload: { configId: 'abc' }, schedule: { cron: '*/5 * * * *' } })
  const once = tasks.scheduleJob({ name: 'sync-later', task: 'sync', payload: { configId: 'abc' }, schedule: { in: 30 } })
  const onceIn = tasks.scheduleJob({ name: 'sync-in', task: 'sync', payload: { configId: 'abc' }, schedule: { in: '5 minutes' } })
  const onceAt = tasks.scheduleJob({ name: 'sync-at', task: 'sync', payload: { configId: 'abc' }, schedule: { at: '2026-01-01T00:00:00Z' } })

  // Return type is inferred from the schedule shape.
  const _recurringIsRecurring: Expect<typeof recurring, RecurringJobInfo> = true
  const _onceIsOnce: Expect<typeof once, OnceJobInfo> = true
  const _onceInIsOnce: Expect<typeof onceIn, OnceJobInfo> = true
  const _onceAtIsOnce: Expect<typeof onceAt, OnceJobInfo> = true

  // A recurring job exposes cron/timezone/nextRuns; a one-shot job's cron is null.
  const _cron: string = recurring.cron
  const _timezone: string = recurring.timezone
  const _nextRuns: string[] = recurring.nextRuns
  const _noCron: null = once.cron

  // Unknown task name is rejected.
  // @ts-expect-error 'nope' is not a registered task
  tasks.scheduleJob({ name: 'x', task: 'nope', schedule: { in: 1 } })

  // Payload is typed against the task's handler.
  // @ts-expect-error configId must be a string
  tasks.scheduleJob({ name: 'y', task: 'sync', payload: { configId: 123 }, schedule: { in: 1 } })

  // run() autocompletes known tasks and rejects typos.
  const result = tasks.run('sync', { payload: { configId: 'abc' } })
  // @ts-expect-error 'nope' is not a registered task
  tasks.run('nope')

  // Duplicate task name at registration is a type error.
  // @ts-expect-error 'sync' is already registered
  tasks.createTask('sync', () => 1)

  return { recurring, once, onceIn, onceAt, result, _recurringIsRecurring, _onceIsOnce, _onceInIsOnce, _onceAtIsOnce, _cron, _timezone, _nextRuns, _noCron }
}
