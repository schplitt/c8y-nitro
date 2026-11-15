// Runs in the `server-no-dev-user` Vitest project: without dev user injection,
// a bearer token reaches the service, and c8y-nitro resolves the caller's
// tenant through /tenant/currentTenant (cached for 60 s per credentials).
import { describe, expect, it } from 'vitest'
import { c8y } from 'c8y-nitro/testing'
import { fetchJson } from './utils'

const asTokenUser = { headers: { authorization: 'Bearer token-of-a-user' } }
const currentTenant = (name: string) => () => ({ name, domainName: `${name}.example.com` })

describe('a new service instance', () => {
  it('resolves the caller\'s tenant again, without the tenant the previous instance cached', async () => {
    c8y.override('GET /tenant/currentTenant', currentTenant(c8y.tenant))
    // the first instance caches the token's tenant
    expect((await fetchJson('/deployed-tenant-only', asTokenUser)).res.status).toBe(200)

    // the same token now belongs to a user of another tenant
    c8y.override('GET /tenant/currentTenant', currentTenant('t99999'))
    expect((await fetchJson('/deployed-tenant-only', asTokenUser)).res.status).toBe(200) // still cached
    await c8y.startService()
    expect((await fetchJson('/deployed-tenant-only', asTokenUser)).res.status).toBe(403)
  })
})
