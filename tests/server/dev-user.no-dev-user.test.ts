// Runs in the `server-no-dev-user` Vitest project: `c8y.dev.injectUser: false`.
import { describe, expect, it } from 'vitest'
import { fetchJson } from './utils'

describe('dev user injection disabled', () => {
  it('does not register the dev user middleware', async () => {
    const upstreamAuthHeader = 'Basic proxy-auth-header'

    const { json } = await fetchJson('/authHeader', {
      headers: { authorization: upstreamAuthHeader },
    })

    expect(json).toEqual({ authHeader: upstreamAuthHeader })
  })
})
