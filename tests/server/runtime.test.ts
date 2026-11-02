import { Buffer } from 'node:buffer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { serverFetch } from 'nitro'
import { captureLogs, completeEnv, fetchJson, sleep, stubC8yEnv } from './utils'

stubC8yEnv()

vi.mock('@c8y/client', async () => {
  const { mockC8yClientModule } = await import('./mocks/c8y-client')
  return mockC8yClientModule()
})

describe('dev user injection', () => {
  it('injects the development user as basic auth', async () => {
    const { json } = await fetchJson('/authHeader')

    expect(json.authHeader).toBe(`Basic ${Buffer.from(`${completeEnv.C8Y_DEVELOPMENT_TENANT}/${completeEnv.C8Y_DEVELOPMENT_USER}:${completeEnv.C8Y_DEVELOPMENT_PASSWORD}`).toString('base64')}`)
  })
})

describe('probes', () => {
  it('registers the liveness and readiness handlers', async () => {
    expect((await serverFetch('/_c8y_nitro/liveness')).status).toBe(200)
    expect((await serverFetch('/_c8y_nitro/readiness')).status).toBe(200)
  })
})

describe('scheduled tasks', () => {
  const logs = captureLogs()
  const logOutput = logs.output

  afterEach(() => {
    logs.clear()
  })

  it('runs a one-shot job after its delay', async () => {
    const marker = `marker-${Date.now()}`

    const { res, json } = await fetchJson(`/schedule-job?marker=${marker}&schedule=0.2`)

    expect(res.status).toBe(200)
    expect(json.job).toEqual({
      name: `log-${marker}`,
      task: 'log',
      kind: 'once',
      concurrency: 'single',
      cron: null,
      nextRun: expect.any(String),
      running: false,
    })
    expect(json.jobs).toContainEqual(json.job)
    expect(logOutput()).not.toContain(`scheduled-task:${marker}`)

    await sleep(Math.max(new Date(json.job.nextRun).getTime() - Date.now(), 0) + 500)

    const { json: listJson } = await fetchJson('/jobs')
    // One-shot jobs remove themselves after running.
    expect(listJson.jobs.map((job: Record<string, any>) => job.name)).not.toContain(`log-${marker}`)
    expect(logOutput()).toContain(`scheduled-task:${marker}`)
  })

  it('runs distinct jobs of the same task in parallel when their windows overlap', async () => {
    // Job 1 fires at +1 s, job 2 at +1.3 s. Both run `sleep-log` with different
    // payloads and overlap from 1.3 s to 2 s. Distinct jobs are independent, so
    // both must complete with their own marker.
    const marker = `parallel-${Date.now()}`

    const { res, json } = await fetchJson(`/schedule-parallel?marker=${marker}`)

    expect(res.status).toBe(200)
    expect(json.job1).toMatchObject({ name: `sleep-${marker}-1`, task: 'sleep-log' })
    expect(json.job2).toMatchObject({ name: `sleep-${marker}-2`, task: 'sleep-log' })
    expect(logOutput()).not.toContain(`sleep-log:${marker}-1`)
    expect(logOutput()).not.toContain(`sleep-log:${marker}-2`)

    // 1.3 s schedule + 0.7 s sleep + buffer
    await sleep(2_500)

    expect(logOutput()).toContain(`sleep-log:${marker}-1`)
    expect(logOutput()).toContain(`sleep-log:${marker}-2`)
  }, 10_000)

  it('does not run a cancelled job', async () => {
    const marker = `cancel-${Date.now()}`

    const { res, json } = await fetchJson(`/cancel-job?marker=${marker}`)

    expect(res.status).toBe(200)
    expect(json.cancelled).toBe(true)
    expect(json.jobs.map((job: Record<string, any>) => job.name)).not.toContain(`cancel-${marker}`)

    await sleep(2_000)

    expect(logOutput()).not.toContain(`scheduled-task:${marker}`)
  })
})
