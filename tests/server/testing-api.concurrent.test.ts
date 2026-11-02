// No file-level arrangements here: they would (correctly) fail every
// concurrent test in the file before it starts.
import { describe, expect, it } from 'vitest'
import { c8y } from 'c8y-nitro/testing'

describe('concurrent tests', () => {
  it.concurrent('reject arrange calls', () => {
    expect(() => c8y.tenantOptions.set('nope', 'nope')).toThrow('cannot be used in concurrent tests')
  })

  it.concurrent('reject requests as a persona', async () => {
    await expect(c8y.persona({ userName: 'nope' }).fetch('/hello')).rejects.toThrow('cannot be used in concurrent tests')
  })
})
