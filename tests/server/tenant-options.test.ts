import { describe, expect, it, vi } from 'vitest'
import { c8yMock } from './mocks/c8y-client'
import { fetchJson, sleep, stubC8yEnv } from './utils'

stubC8yEnv()

vi.mock('@c8y/client', async () => {
  const { mockC8yClientModule } = await import('./mocks/c8y-client')
  return mockC8yClientModule({
    subscriptions: [
      { tenant: 't12345', user: 'serviceuser1', password: 'pass1' },
    ],
    tenantOptions: {
      'myOption': 'hello-world',
      'credentials.secret': 'super-secret-value',
      'cacheExpiryOption': 'cache-initial-value',
    },
    tenantOptionsByCategory: {
      'other-service': {
        foreignKey: 'foreign-initial',
        extraKey: 'extra-value',
      },
    },
  })
})

describe('tenant options', () => {
  it('fetches tenant option values', async () => {
    const { res, json } = await fetchJson('/tenant-options')

    expect(res.status).toBe(200)
    expect(json.myOption).toBe('hello-world')
    expect(json['credentials.secret']).toBe('super-secret-value')
    expect(json.cacheExpiryOption).toBe('cache-initial-value')
    expect(json.message).toBe('Fetched tenant options successfully')
  })

  it('sets, getOrInserts and deletes an option through the handle', async () => {
    const { res, json } = await fetchJson('/tenant-option-crud?key=crudOption')

    expect(res.status).toBe(200)
    // Option was unset, then set() wrote it and the read reflected the new value
    expect(json.before).toBeNull()
    expect(json.afterSet).toBe('crud-value')
    // getOrInsert seeds on first call, returns the existing value on the second
    expect(json.seeded).toBe('seeded-default')
    expect(json.seededAgain).toBe('seeded-default')
    // delete() removed it and the cache was invalidated
    expect(json.afterDelete).toBeNull()
  })

  it('supports dynamic (non-manifest) keys', async () => {
    const dynamicKey = 'encrypted.password.abc123'

    const { res, json } = await fetchJson(`/tenant-option-crud?key=${encodeURIComponent(dynamicKey)}`)

    expect(res.status).toBe(200)
    expect(json.key).toBe(dynamicKey)
    expect(json.afterSet).toBe('crud-value')
    expect(json.afterDelete).toBeNull()
  })

  it('bulk sets and lists options of the own category', async () => {
    const { res, json } = await fetchJson('/tenant-options-category')

    expect(res.status).toBe(200)
    expect(json.listed).toMatchObject({ bulkA: 'value-a', bulkB: 'value-b' })
    expect(json.message).toBe('Category options listed successfully')
  })

  it('reads, writes and lists options from a foreign category', async () => {
    const { res, json } = await fetchJson('/tenant-options-foreign?category=other-service')

    expect(res.status).toBe(200)
    expect(json.category).toBe('other-service')
    expect(json.initial).toBe('foreign-initial')
    expect(json.afterSet).toBe('foreign-updated')
    expect(json.listed).toMatchObject({ foreignKey: 'foreign-updated', extraKey: 'extra-value' })
    // Single option in a foreign category via useTenantOptions(client, category).option(key)
    expect(json.single).toBe('extra-value')
  })

  it('keeps the cached value until the TTL expires', async () => {
    // `cacheExpiryOption` has a 4 s TTL in the fixture config
    expect((await fetchJson('/tenant-options')).json.cacheExpiryOption).toBe('cache-initial-value')

    c8yMock.setOption('cacheExpiryOption', 'cache-updated-value')

    await sleep(2_000)
    expect((await fetchJson('/tenant-options')).json.cacheExpiryOption).toBe('cache-initial-value')

    await sleep(3_200)
    expect((await fetchJson('/tenant-options')).json.cacheExpiryOption).toBe('cache-updated-value')
  }, 8_000)
})

describe('tenant option invalidation route', () => {
  it('invalidates a created tenant option cache by key', async () => {
    await fetchJson('/tenant-options')

    const { res, json } = await fetchJson('/_c8y_nitro/invalidate-tenant-options?key=myOption')

    expect(res.status).toBe(200)
    expect(json.message).toBe('success')
  })

  it('serves the new value after invalidation', async () => {
    expect((await fetchJson('/tenant-options')).json.myOption).toBe('hello-world')
    c8yMock.setOption('myOption', 'invalidated-value')
    expect((await fetchJson('/tenant-options')).json.myOption).toBe('hello-world')

    await fetchJson('/_c8y_nitro/invalidate-tenant-options?key=myOption')

    expect((await fetchJson('/tenant-options')).json.myOption).toBe('invalidated-value')
  })

  it('skips invalidation when the key fetcher was not created yet', async () => {
    const { res, json } = await fetchJson('/_c8y_nitro/invalidate-tenant-options?key=credentials.secret')

    expect(res.status).toBe(200)
    expect(json.message).toBe('success')
  })

  it('prioritizes all over key when both query params are present', async () => {
    await fetchJson('/tenant-options')

    const { res, json } = await fetchJson('/_c8y_nitro/invalidate-tenant-options?all=1&key=myOption')

    expect(res.status).toBe(200)
    expect(json.message).toBe('success')
  })

  it('rejects unknown tenant option keys', async () => {
    const { res, json } = await fetchJson('/_c8y_nitro/invalidate-tenant-options?key=unknown.option')

    expect(res.status).toBe(400)
    expect(json.message).toBe('Invalid tenant option invalidation request')
  })

  it('rejects invalidation requests without all or key', async () => {
    const { res, json } = await fetchJson('/_c8y_nitro/invalidate-tenant-options')

    expect(res.status).toBe(400)
    expect(json.message).toBe('Provide either the all or key query parameter')
  })
})
