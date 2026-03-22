import { describe, expect, test } from 'vitest'
import { Buffer } from 'node:buffer'
import {
  createCurrentUserTenantCacheKey,
  getCurrentUserTenantCacheKeyMaterial,
  tryGetTenantFromBasicAuth,
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
