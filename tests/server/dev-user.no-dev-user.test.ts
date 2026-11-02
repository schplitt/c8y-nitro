// Runs in the `server-no-dev-user` Vitest project: `c8y.dev.injectUser: false`.
import { describe, expect, it, vi } from 'vitest'
import { fetchJson, stubC8yEnv } from './utils'

stubC8yEnv()

vi.mock('@c8y/client', async () => {
  const { mockC8yClientModule } = await import('./mocks/c8y-client')
  return mockC8yClientModule()
})

describe('dev user injection disabled', () => {
  it('does not register the dev user middleware', async () => {
    const upstreamAuthHeader = 'Basic proxy-auth-header'

    const { json } = await fetchJson('/authHeader', {
      headers: { authorization: upstreamAuthHeader },
    })

    expect(json).toEqual({ authHeader: upstreamAuthHeader })
  })
})
