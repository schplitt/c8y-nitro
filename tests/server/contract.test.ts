// Runs the contract scenarios (tests/contract) against the fake tenant.
import process from 'node:process'
import { BasicAuth, Client } from '@c8y/client'
import { createRealtimeClient } from 'c8y-realtime'
import type { RealtimeClient, WebSocketFactory } from 'c8y-realtime'
import { afterEach, describe, it } from 'vitest'
import { c8y } from 'c8y-nitro/testing'
import { scenarios } from '../contract/scenarios'

const credentials = () => ({ tenant: c8y.tenant, user: 'contract-user', password: 'contract-password' })
const realtimeClients: RealtimeClient[] = []

afterEach(async () => {
  await Promise.all(realtimeClients.splice(0).map((client) => client.close()))
})

describe('contract scenarios against the fake tenant', () => {
  for (const scenario of scenarios) {
    it(scenario.name, async () => {
      const unique = `ctr${Date.now()}`
      await scenario.run({
        client: new Client(new BasicAuth(credentials()), process.env.C8Y_BASEURL),
        unique,
        tenant: c8y.tenant,
        realtime: () => {
          // the fake tenant's WebSocket, as c8y-nitro's realtime client gets it
          const hooks = (globalThis as Record<symbol, { WebSocket?: unknown }>)[Symbol.for('c8y-nitro.testing')]
          const client = createRealtimeClient({
            ...credentials(),
            baseUrl: process.env.C8Y_BASEURL!,
            name: unique,
            webSocketImpl: hooks!.WebSocket as WebSocketFactory,
            subscription: { nonPersistent: true },
          })
          realtimeClients.push(client)
          return client
        },
      })
    }, 20_000)
  }
})
