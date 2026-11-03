import { afterEach, describe, expect, it } from 'vitest'
import { serverFetch } from 'nitro'
import { captureLogs, fetchJson, sleep } from './utils'

describe('logging', () => {
  const logs = captureLogs()

  afterEach(() => {
    logs.clear()
  })

  it('logs the wide event context for the success path', async () => {
    const { res, json } = await fetchJson('/logging/success')

    expect(res.status).toBe(200)
    expect(json.message).toBe('ok')
    expect(json.action).toBe('test-success')

    // wide events are emitted after the response
    await sleep(100)

    expect(logs.output()).toMatch(/GET \/logging\/success/)
    expect(logs.output()).toContain('user_123')
  })

  it('accepts the useRequest() ServerRequest in useLogger (no H3Event)', async () => {
    const { res, json } = await fetchJson('/logging/via-request')

    expect(res.status).toBe(200)
    expect(json.message).toBe('ok')
    expect(json.action).toBe('test-via-request')

    await sleep(100)

    expect(logs.output()).toMatch(/GET \/logging\/via-request/)
    expect(logs.output()).toContain('user_789')
  })

  it('logs the error wide event and returns structured error JSON', async () => {
    const { res, json } = await fetchJson('/logging/error')

    expect(res.status).toBe(400)
    expect(json.message).toBe('Something went wrong')
    expect(json.data.why).toBe('Test error occurred for logging verification')
    expect(json.data.fix).toBe('This is a test fixture, nothing to fix')
    expect(json.data.link).toBe('https://www.evlog.dev/core-concepts/structured-errors')

    await sleep(100)

    expect(logs.output()).toMatch(/GET \/logging\/error/)
    expect(logs.output()).toContain('user_456')
  })

  it('does not log liveness and readiness probe requests', async () => {
    expect((await serverFetch('/_c8y_nitro/liveness')).status).toBe(200)
    expect((await serverFetch('/_c8y_nitro/readiness')).status).toBe(200)
    expect((await serverFetch('/hello')).status).toBe(200)

    await sleep(100)

    expect(logs.output()).toMatch(/GET \/hello/)
    expect(logs.output()).not.toMatch(/GET \/_c8y_nitro\/liveness/)
    expect(logs.output()).not.toMatch(/GET \/_c8y_nitro\/readiness/)
  })
})
