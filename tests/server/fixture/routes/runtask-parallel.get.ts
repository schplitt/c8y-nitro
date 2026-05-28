import { defineEventHandler, getQuery } from 'nitro/h3'
import { runTask } from 'nitro/task'

/**
 * Demonstrates Nitro's built-in runTask() name-only deduplication.\
 * Starts task 1 then waits a tick so __runningTasks__ is populated before
 * starting task 2 \u2014 the second call receives the first task's result and its
 * handler is never invoked.\
 * Contrast with /schedule-parallel which uses our direct handler resolution.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const marker = typeof query.marker === 'string' ? query.marker : 'default'

  // Start task 1 \u2014 do NOT await yet so task 2 can be issued while task 1 runs
  const promise1 = runTask('scheduler:sleep-log', {
    payload: { marker: `${marker}-1`, sleepMs: 700 },
  })

  // Yield enough time for runTask()'s internal `await tasks[name].resolve!()`
  // to complete and populate __runningTasks__[name].  Without this yield the
  // two calls would race past the dedup check before either sets the lock.
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 50)
  })

  // Task 1 is now registered in __runningTasks__. This call will hit the dedup
  // lock, return task 1\u2019s promise, and never invoke the handler with marker-2.
  const promise2 = runTask('scheduler:sleep-log', {
    payload: { marker: `${marker}-2`, sleepMs: 700 },
  })

  const [result1, result2] = await Promise.all([promise1, promise2])

  return { result1, result2, deduplicated: result1 === result2 }
})
