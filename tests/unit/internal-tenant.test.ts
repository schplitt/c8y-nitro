import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Buffer } from 'node:buffer'
import {
  buildPublicRequestUrl,
  clearFastUserTenantDomainCache,
  createCurrentUserTenantCacheKey,
  getCurrentUserTenantCacheKeyMaterial,
  tryGetTenantFromBasicAuth,
  tryGetUserTenantDomainFast,
} from '../../src/utils/internal/tenant'

type RequestHeaders = ConstructorParameters<typeof Headers>[0]

function createRequest(headers: RequestHeaders): Request {
  const request = new Request('https://example.com', { headers }) as Request & { context?: Record<string, unknown> }
  request.context = {}
  return request
}

describe('internal tenant helpers', () => {
  test('extracts tenant from basic auth', () => {
    const auth = Buffer.from('t12345/some.user@example.com:password').toString('base64')
    const request = createRequest({ authorization: `Basic ${auth}` })

    expect(tryGetTenantFromBasicAuth(request as any)).toBe('t12345')
  })

  test('prefers authorization cookie over authorization header for cache key material', () => {
    const request = createRequest({
      authorization: 'Bearer header-token',
      cookie: 'foo=bar; authorization=cookie-token; XSRF-TOKEN=abc',
    })

    expect(getCurrentUserTenantCacheKeyMaterial(request as any)).toBe('cookie:cookie-token')
  })

  test('creates stable cache key for the same auth material within one run', () => {
    const requestA = createRequest({ authorization: 'Bearer same-token' })
    const requestB = createRequest({ authorization: 'Bearer same-token' })

    expect(createCurrentUserTenantCacheKey(requestA as any)).toBe(createCurrentUserTenantCacheKey(requestB as any))
  })

  test('creates different cache keys for different auth material', () => {
    const requestA = createRequest({ authorization: 'Bearer token-a' })
    const requestB = createRequest({ authorization: 'Bearer token-b' })

    expect(createCurrentUserTenantCacheKey(requestA as any)).not.toBe(createCurrentUserTenantCacheKey(requestB as any))
  })

  test('throws when trying to create a cache key without auth material', () => {
    const request = createRequest({})

    expect(() => createCurrentUserTenantCacheKey(request as any)).toThrow(
      'Cannot create current user tenant cache key without auth material',
    )
  })
})

describe('buildPublicRequestUrl', () => {
  test('builds the public tenant URL with the service prefix', () => {
    const url = buildPublicRequestUrl(
      'tenant.cumulocity.com',
      'my-service',
      new URL('http://scope-t123.cluster.svc.cluster.local/agents/assistant?foo=bar'),
    )

    expect(url.href).toBe('https://tenant.cumulocity.com/service/my-service/agents/assistant?foo=bar')
  })

  test('handles the root path without a query', () => {
    const url = buildPublicRequestUrl(
      'tenant.cumulocity.com',
      'my-service',
      new URL('http://internal.local/'),
    )

    expect(url.href).toBe('https://tenant.cumulocity.com/service/my-service/')
  })
})

describe('tryGetUserTenantDomainFast', () => {
  beforeEach(() => {
    clearFastUserTenantDomainCache()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('returns undefined without auth material and never calls the resolver', async () => {
    const resolve = vi.fn()

    expect(await tryGetUserTenantDomainFast(createRequest({}) as any, resolve)).toBeUndefined()
    expect(resolve).not.toHaveBeenCalled()
  })

  test('resolves once per auth material and serves repeats from the cache', async () => {
    const resolve = vi.fn().mockResolvedValue('tenant.cumulocity.com')
    const request = () => createRequest({ authorization: 'Bearer same-token' }) as any

    expect(await tryGetUserTenantDomainFast(request(), resolve)).toBe('tenant.cumulocity.com')
    expect(await tryGetUserTenantDomainFast(request(), resolve)).toBe('tenant.cumulocity.com')
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  test('resolves separately for different auth material', async () => {
    const resolve = vi.fn()
      .mockResolvedValueOnce('a.cumulocity.com')
      .mockResolvedValueOnce('b.cumulocity.com')

    expect(await tryGetUserTenantDomainFast(createRequest({ authorization: 'Bearer token-a' }) as any, resolve)).toBe('a.cumulocity.com')
    expect(await tryGetUserTenantDomainFast(createRequest({ authorization: 'Bearer token-b' }) as any, resolve)).toBe('b.cumulocity.com')
    expect(resolve).toHaveBeenCalledTimes(2)
  })

  test('re-resolves after the success TTL expires', async () => {
    const resolve = vi.fn().mockResolvedValue('tenant.cumulocity.com')
    const request = () => createRequest({ authorization: 'Bearer same-token' }) as any

    await tryGetUserTenantDomainFast(request(), resolve)
    vi.advanceTimersByTime(61_000)
    await tryGetUserTenantDomainFast(request(), resolve)

    expect(resolve).toHaveBeenCalledTimes(2)
  })

  test('caches failed lookups briefly instead of throwing', async () => {
    const resolve = vi.fn().mockRejectedValue(new Error('unauthorized'))
    const request = () => createRequest({ authorization: 'Bearer bad-token' }) as any

    expect(await tryGetUserTenantDomainFast(request(), resolve)).toBeUndefined()
    expect(await tryGetUserTenantDomainFast(request(), resolve)).toBeUndefined()
    expect(resolve).toHaveBeenCalledTimes(1)

    // failure TTL is shorter than the success TTL
    vi.advanceTimersByTime(11_000)
    await tryGetUserTenantDomainFast(request(), resolve)
    expect(resolve).toHaveBeenCalledTimes(2)
  })

  test('evicts the oldest entry once the cache is full', async () => {
    const resolve = vi.fn().mockResolvedValue('tenant.cumulocity.com')
    const request = (index: number) => createRequest({ authorization: `Bearer token-${index}` }) as any

    for (let index = 0; index <= 1000; index++) {
      await tryGetUserTenantDomainFast(request(index), resolve)
    }
    expect(resolve).toHaveBeenCalledTimes(1001)

    // entry 0 was evicted by entry 1000, entry 1 is still cached
    await tryGetUserTenantDomainFast(request(1), resolve)
    expect(resolve).toHaveBeenCalledTimes(1001)
    await tryGetUserTenantDomainFast(request(0), resolve)
    expect(resolve).toHaveBeenCalledTimes(1002)
  })
})
