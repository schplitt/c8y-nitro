// c8yTest({ service: 'per-file' }) (project server-per-file): the tests of a
// file share one service instance unless the file says otherwise.
// Order-dependent on purpose: tests compare with the instance the previous
// test saw.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { c8y } from 'c8y-nitro/testing'
import { fetchJson } from './utils'

const instance = async () => (await fetchJson('/instance')).json.instance as number
const myOption = async () => (await fetchJson('/tenant-options')).json.myOption as string | null

// file-level data: the shared service starts on it
const pump = c8y.device({ name: 'file-pump' })

let shared = 0

describe('one service per file', () => {
  it('starts the service before the first test', async () => {
    shared = await instance()
    expect(shared).toBeGreaterThan(0)
  })

  it('shares it with the next test', async () => {
    expect(shared).toBeGreaterThan(0)
    expect(await instance()).toBe(shared)
  })

  it('so caches carry over between tests', async () => {
    c8y.tenantOptions.set('myOption', 'cached')
    expect(await myOption()).toBe('cached') // read once: now cached by the service
    c8y.tenantOptions.set('myOption', 'changed')
    expect(await myOption()).toBe('cached')
  })

  it('keeps file-level data and refs valid on the shared service', async () => {
    expect((await fetchJson(`/devices/${pump.id}`)).json.name).toBe('file-pump')
  })

  it('still rebuilds the platform data before every test', () => {
    c8y.device({ name: 'test-only' })
    expect(c8y.db.managedObjects.find({ name: 'test-only' })).toHaveLength(1)
  })

  it('so data of the test before is gone', () => {
    expect(c8y.db.managedObjects.find({ name: 'test-only' })).toEqual([])
  })
})

describe('beforeEach(() => c8y.startService())', () => {
  beforeEach(() => c8y.startService())
  let previous = 0

  it('gives a test its own service', async () => {
    previous = await instance()
    expect(shared).toBeGreaterThan(0)
    expect(previous).not.toBe(shared)
  })

  it('and the next test another one, with empty caches', async () => {
    expect(previous).toBeGreaterThan(0)
    expect(await instance()).not.toBe(previous)
    c8y.tenantOptions.set('myOption', 'fresh')
    expect(await myOption()).toBe('fresh')
  })
})

describe('beforeAll(() => c8y.startService())', () => {
  beforeAll(() => c8y.startService())
  c8y.tenantOptions.set('myOption', 'describe-level')
  let own = 0

  it('gives the describe its own shared service', async () => {
    own = await instance()
    expect(shared).toBeGreaterThan(0)
    expect(own).not.toBe(shared)
  })

  it('shared by its tests, started on the describe\'s data', async () => {
    expect(own).toBeGreaterThan(0)
    expect(await instance()).toBe(own)
    expect(await myOption()).toBe('describe-level')
  })
})

describe('after other scopes', () => {
  let again = 0

  it('the file\'s tests get a new shared service', async () => {
    again = await instance()
    expect(shared).toBeGreaterThan(0)
    expect(again).not.toBe(shared)
  })

  it('which the following file tests share', async () => {
    expect(again).toBeGreaterThan(0)
    expect(await instance()).toBe(again)
  })
})

describe('startService() inside a test', () => {
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

  it('and the next test gets a new shared service, not that one', async () => {
    expect(restarted).toBeGreaterThan(0)
    expect(await instance()).not.toBe(restarted)
  })
})

describe('a retried test', () => {
  let firstAttempt = 0

  it('runs on the shared service again', { retry: 1 }, async () => {
    const current = await instance()
    if (firstAttempt === 0) {
      firstAttempt = current
      throw new Error('fail the first attempt')
    }
    expect(current).toBe(firstAttempt)
  })
})
