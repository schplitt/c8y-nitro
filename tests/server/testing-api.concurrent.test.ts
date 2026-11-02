// No file-level arrangements here: they would (correctly) fail every
// concurrent test in the file before it starts.
import { describe, expect, it } from 'vitest'
import { c8y, serverFetch } from 'c8y-nitro/testing'

describe('concurrent tests', () => {
  it.concurrent('reject arrange calls', () => {
    expect(() => c8y.tenantOptions.set('nope', 'nope')).toThrow('cannot be used in concurrent tests')
  })

  it.concurrent('reject requests as another user', async () => {
    await expect(serverFetch('/hello', { as: { userName: 'nope' } })).rejects.toThrow('cannot be used in concurrent tests')
  })
})
