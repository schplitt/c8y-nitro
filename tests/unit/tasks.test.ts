import type { TaskEvent } from '../../src/utils/tasks'
import { describe, expect, it, vi } from 'vitest'
import { c8yTasks } from '../../src/utils/tasks'

// A cron far enough in the future that scheduled jobs never auto-fire during a
// test — we drive execution deterministically via triggerJob().
const NEVER_CRON = '0 0 1 1 *'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('c8yTasks registry', () => {
  it('registers tasks and reports them via hasTask', () => {
    const tasks = c8yTasks()
      .createTask('a', () => 1)
      .createTask('b', () => 2)

    expect(tasks.hasTask('a')).toBe(true)
    expect(tasks.hasTask('b')).toBe(true)
    expect(tasks.hasTask('c')).toBe(false)
  })

  it('throws when registering a duplicate task name', () => {
    const tasks = c8yTasks().createTask('a', () => 1)
    expect(() => (tasks as any).createTask('a', () => 2)).toThrow(/already registered/)
  })

  it('runs a task ad-hoc with its payload and returns the result', async () => {
    const handler = vi.fn((event: TaskEvent<{ n: number }>) => event.payload.n * 2)
    const tasks = c8yTasks().createTask('double', handler)

    await expect(tasks.run('double', { payload: { n: 21 } })).resolves.toBe(42)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.lastCall?.[0]).toMatchObject({ task: 'double', payload: { n: 21 } })
  })

  it('rejects scheduling a job for an unregistered task', () => {
    const tasks = c8yTasks().createTask('a', () => 1)
    expect(() => tasks.scheduleJob({ name: 'j', task: 'b' as any, schedule: { cron: NEVER_CRON } })).toThrow(/not registered/)
  })

  it('rejects a duplicate job name unless replace is set', () => {
    const tasks = c8yTasks().createTask('a', () => 1)
    tasks.scheduleJob({ name: 'j', task: 'a', schedule: { cron: NEVER_CRON } })

    expect(() => tasks.scheduleJob({ name: 'j', task: 'a', schedule: { cron: NEVER_CRON } })).toThrow(/already exists/)
    expect(() => tasks.scheduleJob({ name: 'j', task: 'a', schedule: { cron: NEVER_CRON }, replace: true })).not.toThrow()

    tasks.cancelJob('j')
  })

  it('exposes recurring schedule info and defaults timezone to UTC', () => {
    const tasks = c8yTasks().createTask('a', () => 1)
    const info = tasks.scheduleJob({ name: 'j', task: 'a', schedule: { cron: NEVER_CRON } })

    expect(info).toMatchObject({ name: 'j', task: 'a', kind: 'recurring', concurrency: 'single', cron: NEVER_CRON, timezone: 'UTC' })
    expect(info.nextRun).toEqual(expect.any(String))
    expect(info.nextRuns.length).toBeGreaterThan(0)

    expect(tasks.getJob('j')).toMatchObject({ name: 'j' })
    expect(tasks.listJobs().map((job) => job.name)).toContain('j')

    tasks.cancelJob('j')
  })

  it('honors an explicit timezone for recurring jobs', () => {
    const tasks = c8yTasks().createTask('a', () => 1)
    const info = tasks.scheduleJob({ name: 'j', task: 'a', schedule: { cron: NEVER_CRON }, timezone: 'Europe/Berlin' })

    expect(info).toMatchObject({ kind: 'recurring', timezone: 'Europe/Berlin' })

    tasks.cancelJob('j')
  })

  it('cancelJob stops the job and removes it', () => {
    const tasks = c8yTasks().createTask('a', () => 1)
    tasks.scheduleJob({ name: 'j', task: 'a', schedule: { cron: NEVER_CRON } })

    expect(tasks.cancelJob('j')).toBe(true)
    expect(tasks.getJob('j')).toBeUndefined()
    expect(tasks.cancelJob('j')).toBe(false)
  })

  it('single concurrency coalesces overlapping triggers into one run', async () => {
    const gate = deferred()
    let started = 0
    let maxConcurrent = 0
    let running = 0

    const tasks = c8yTasks().createTask('slow', async () => {
      started++
      running++
      maxConcurrent = Math.max(maxConcurrent, running)
      await gate.promise
      running--
      return started
    })
    tasks.scheduleJob({ name: 'j', task: 'slow', schedule: { cron: NEVER_CRON }, concurrency: 'single' })

    const p1 = tasks.triggerJob('j')
    const p2 = tasks.triggerJob('j')

    expect(tasks.getJob('j')?.running).toBe(true)

    gate.resolve()
    const [r1, r2] = await Promise.all([p1, p2])

    // Both triggers observed the same in-flight run.
    expect(started).toBe(1)
    expect(maxConcurrent).toBe(1)
    expect(r1).toBe(r2)

    tasks.cancelJob('j')
  })

  it('parallel concurrency runs overlapping triggers concurrently', async () => {
    const gate = deferred()
    let started = 0
    let maxConcurrent = 0
    let running = 0

    const tasks = c8yTasks().createTask('slow', async () => {
      started++
      running++
      maxConcurrent = Math.max(maxConcurrent, running)
      await gate.promise
      running--
    })
    tasks.scheduleJob({ name: 'j', task: 'slow', schedule: { cron: NEVER_CRON }, concurrency: 'parallel' })

    const p1 = tasks.triggerJob('j')
    const p2 = tasks.triggerJob('j')

    gate.resolve()
    await Promise.all([p1, p2])

    expect(started).toBe(2)
    expect(maxConcurrent).toBe(2)

    tasks.cancelJob('j')
  })

  it('runs a one-shot job and removes it afterwards', async () => {
    const handler = vi.fn()
    const tasks = c8yTasks().createTask('once', handler)

    const info = tasks.scheduleJob({ name: 'j', task: 'once', schedule: { in: 0 } })
    expect(info.kind).toBe('once')

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1)
      expect(tasks.getJob('j')).toBeUndefined()
    })
  })

  it('validates one-shot schedule inputs', () => {
    const tasks = c8yTasks().createTask('a', () => 1)
    expect(() => tasks.scheduleJob({ name: 'j1', task: 'a', schedule: { in: -1 } })).toThrow(/non-negative/)
    expect(() => tasks.scheduleJob({ name: 'j2', task: 'a', schedule: { at: 'not-a-date' } })).toThrow(/valid Date or ISO/)
  })
})
