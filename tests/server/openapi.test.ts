import { describe, expect, it } from 'vitest'
import { serverFetch } from 'nitro'
import { fetchJson } from './utils'

describe('OpenAPI transformation', () => {
  it('strips internal and excluded routes from the OpenAPI document', async () => {
    const { res, json: spec } = await fetchJson('/_openapi.json')

    expect(res.status).toBe(200)
    const paths = Object.keys(spec.paths ?? {})
    expect(paths.length).toBeGreaterThan(0)
    // internal routes (probes, invalidation route, spec/UI routes) are gone
    expect(paths.filter((path) => path.startsWith('/_'))).toEqual([])
    // user-configured excludeRoutes are gone
    expect(paths).not.toContain('/hidden')
    // regular routes stay
    expect(paths).toContain('/hello')
  })

  it('does not transform other routes', async () => {
    expect((await serverFetch('/hello')).status).toBe(200)
  })

  it('advertises the request origin in dev', async () => {
    const { json: spec } = await fetchJson('/_openapi.json')

    // a plain origin without the /service/<contextPath> prefix
    expect(spec.servers).toHaveLength(1)
    expect(spec.servers[0].description).toBe('Direct server endpoint')
    expect(spec.servers[0].url).toMatch(/^http:\/\/[^/]+$/)
  })

  it('derives the server URL from forwarding headers when proxied', async () => {
    const { json: spec } = await fetchJson('/_openapi.json', {
      headers: {
        'x-forwarded-host': 'proxied.example.cumulocity.com',
        'x-forwarded-proto': 'https',
      },
    })

    expect(spec.servers).toEqual([{
      url: 'https://proxied.example.cumulocity.com/service/c8y-nitro',
      description: 'Cumulocity microservice endpoint',
    }])
  })
})
