// Runs the contract scenarios (tests/contract) against the fake tenant.
import process from 'node:process'
import { BasicAuth, Client } from '@c8y/client'
import { describe, it } from 'vitest'
import { c8y } from 'c8y-nitro/testing'
import { scenarios } from '../contract/scenarios'

describe('contract scenarios against the fake tenant', () => {
  for (const scenario of scenarios) {
    it(scenario.name, async () => {
      const client = new Client(new BasicAuth({ tenant: c8y.tenant, user: 'contract-user', password: 'contract-password' }), process.env.C8Y_BASEURL)
      await scenario.run({ client, unique: String(Date.now()) })
    })
  }
})
