// Service instances: which tests share one Nitro app (plugins, caches,
// realtime clients). Order-dependent on purpose: tests compare with the
// instance the previous test saw.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { c8y } from 'c8y-nitro/testing'
import { clearCredentialHookEvents, getCredentialHookEvents } from './fixture/plugins/00-credentials-hook-recorder'
import { fetchJson } from './utils'

const instance = async () => (await fetchJson('/instance')).json.instance as number
const myOption = async () => (await fetchJson('/tenant-options')).json.myOption as string | null

describe('by default (a new service per test)', () => {
  let first = 0

  it('starts a service for a test', async () => {
    first = await instance()
    expect(first).toBeGreaterThan(0)
    c8y.tenantOptions.set('myOption', 'first')
    expect(await myOption()).toBe('first')
  })

  it('and a new one for the next test, with empty caches', async () => {
    expect(first).toBeGreaterThan(0)
    expect(await instance()).not.toBe(first)
    c8y.tenantOptions.set('myOption', 'second')
    expect(await myOption()).toBe('second')
  })
})

describe('startService() in beforeAll', () => {
  beforeAll(() => c8y.startService())
  let shared = 0

  it('starts one service for the describe', async () => {
    shared = await instance()
    expect(shared).toBeGreaterThan(0)
  })

  it('shared by its tests', async () => {
    expect(shared).toBeGreaterThan(0)
    expect(await instance()).toBe(shared)
  })

  it('so caches carry over between them', async () => {
    c8y.tenantOptions.set('myOption', 'cached')
    expect(await myOption()).toBe('cached')
  })

  it('and a changed platform value it cached is not seen', async () => {
    c8y.tenantOptions.set('myOption', 'cached')
    expect(await myOption()).toBe('cached') // read once: now cached by the service
    c8y.tenantOptions.set('myOption', 'changed')
    expect(await myOption()).toBe('cached')
  })

  describe('a nested describe', () => {
    it('shares it too', async () => {
      expect(shared).toBeGreaterThan(0)
      expect(await instance()).toBe(shared)
    })
  })

  describe('a nested describe with startService() in beforeEach', () => {
    beforeEach(() => c8y.startService())
    let previous = 0

    it('gets a new service for a test', async () => {
      previous = await instance()
      expect(shared).toBeGreaterThan(0)
      expect(previous).not.toBe(shared)
    })

    it('and for the next one', async () => {
      expect(previous).toBeGreaterThan(0)
      expect(await instance()).not.toBe(previous)
    })
  })
})

describe('after a shared describe', () => {
  let first = 0

  it('tests get their own service again', async () => {
    first = await instance()
  })

  it('every one of them', async () => {
    expect(first).toBeGreaterThan(0)
    expect(await instance()).not.toBe(first)
  })
})

describe('startService() inside a test', () => {
  beforeAll(() => c8y.startService())
  let before = 0
  let restarted = 0

  it('starts a new service on the test\'s data', async () => {
    before = await instance()
    c8y.tenantOptions.set('myOption', 'arranged')
    await c8y.startService()
    restarted = await instance()
    expect(restarted).not.toBe(before)
    expect(await myOption()).toBe('arranged')
  })

  it('and the next test of the shared scope gets a new shared one', async () => {
    expect(restarted).toBeGreaterThan(0)
    expect(await instance()).not.toBe(restarted)
  })
})

describe('a retried test', () => {
  let firstAttempt = 0

  it('gets a new service by default', { retry: 1 }, async () => {
    const current = await instance()
    if (firstAttempt === 0) {
      firstAttempt = current
      throw new Error('fail the first attempt')
    }
    expect(current).not.toBe(firstAttempt)
  })
})

describe('a new service starts like a fresh process', () => {
  it('emits the first credentials event from null', async () => {
    clearCredentialHookEvents()
    await c8y.startService()

    // the startup of the new service read the credentials (realtime plugin)
    expect(getCredentialHookEvents()).toMatchObject([{ prevTenants: null }])
  })

  it('has only the jobs its own plugins scheduled', async () => {
    // imported lazily: c8y-nitro/utils must not load before Nitro created the app
    const { tasks } = await import('./fixture/scheduler')
    // the boot-job plugin scheduled it again; the old service's job is gone
    expect(tasks.listJobs().map((job) => job.name)).toEqual(['boot-job'])
  })

  describe('in a shared describe', () => {
    beforeAll(() => c8y.startService())
    let firstAttempt = 0

    it('a retried test runs on the shared service again', { retry: 1 }, async () => {
      const current = await instance()
      if (firstAttempt === 0) {
        firstAttempt = current
        throw new Error('fail the first attempt')
      }
      expect(current).toBe(firstAttempt)
    })
  })
})

describe('a strategy arranged for a shared service', () => {
  beforeAll(() => c8y.startService())
  c8y.apply({ onUnhandledRequest: 'ignore' })

  it('applies to its first test', async () => {
    await fetchJson('/platform/features')
    expect(c8y.unhandled).toHaveLength(1)
  })

  it('and to the next one', async () => {
    await fetchJson('/platform/features')
    expect(c8y.unhandled).toHaveLength(1)
  })
})

describe('startService() inside a test keeps the test\'s own log', () => {
  it('calls and unhandled requests from before the restart', async () => {
    c8y.apply({ onUnhandledRequest: 'ignore' })
    await fetchJson('/platform/features')
    await c8y.startService()

    expect(c8y).toHaveReceived('GET /features', { times: 1 })
    expect(c8y.unhandled).toMatchObject([{ path: '/features' }])
  })
})

describe('concurrent tests', () => {
  describe('after a test with its own data', () => {
    c8y.device({ name: 'only-in-this-describe' })
    it('arranges a device', () => {
      expect(c8y.db.managedObjects.find({ name: 'only-in-this-describe' })).toHaveLength(1)
    })
  })

  describe('run concurrently', { concurrent: true }, () => {
    it('share one service on a clean tenant', async () => {
      const { json } = await fetchJson('/instance')
      expect(json.instance).toBeGreaterThan(0)
      expect((await fetchJson('/hello')).res.status).toBe(200)
    })

    it('on a clean tenant, without the data of the test before', () => {
      expect(c8y.db.managedObjects.find()).toEqual([])
    })
  })
})

describe('misuse', () => {
  describe('startService() in afterAll', () => {
    afterAll(async () => {
      await expect(c8y.startService()).rejects.toThrow('cannot be called in afterAll()')
    })

    it('runs a test first', () => {})
  })
})
