// Runs the contract scenarios (tests/contract) against the fake tenant.
import process from 'node:process'
import { BasicAuth, Client } from '@c8y/client'
import { createRealtimeClient } from 'c8y-realtime'
import type { RealtimeClient, WebSocketFactory } from 'c8y-realtime'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { c8y } from 'c8y-nitro/testing'
import { scenarios } from '../contract/scenarios'
import { C8Y_ENDPOINTS } from '../../src/testing/capabilities.generated'

// the fake's current user (`test-user`), so /user/currentUser and the
// authenticated user agree like on a real tenant
const credentials = () => ({ tenant: c8y.tenant, user: 'test-user', password: 'contract-password' })
const realtimeClients: RealtimeClient[] = []

// Platform requests of all scenarios, for the coverage check below
const exercised: Array<{ method: string, path: string, query: string[] }> = []

afterEach(async () => {
  await Promise.all(realtimeClients.splice(0).map((client) => client.close()))
  exercised.push(...c8y.calls.map((call) => ({ method: call.method, path: call.path, query: Object.keys(call.query) })))
})

// Endpoints the fake answers itself (not in the generated table)
const BUILT_IN_ENDPOINTS = [
  'GET /user/currentUser',
  'GET /tenant/currentTenant',
  'GET /tenant/options/{category}/{key}',
  'PUT /tenant/options/{category}/{key}',
  'DELETE /tenant/options/{category}/{key}',
  'GET /tenant/options/{category}',
  'PUT /tenant/options/{category}',
]

function matches(endpoint: string, call: { method: string, path: string }): boolean {
  const [method, template] = endpoint.split(' ') as [string, string]
  const pattern = new RegExp(`^${template.replace(/\{[^}]+\}/g, '[^/]+')}$`)
  return method === call.method && pattern.test(call.path)
}

// Every emulated endpoint must be exercised by a contract scenario, so every
// one of them is also checked against a real tenant (pnpm test:contract).
afterAll(() => {
  const endpoints = [...Object.keys(C8Y_ENDPOINTS), ...BUILT_IN_ENDPOINTS]
  const uncovered = endpoints.filter((endpoint) => !exercised.some((call) => matches(endpoint, call)))
  const untestedParams = Object.entries(C8Y_ENDPOINTS).flatMap(([endpoint, { query }]) => {
    const used = new Set(exercised.filter((call) => matches(endpoint, call)).flatMap((call) => call.query))
    const missing = query.filter((name) => !used.has(name))
    return missing.length > 0 ? [`${endpoint}: ${missing.join(', ')}`] : []
  })
  if (process.env.C8Y_CONTRACT_COVERAGE) {
    console.warn(`Endpoints not exercised:\n${uncovered.join('\n') || '(none)'}\n\nSpec query parameters not exercised:\n${untestedParams.join('\n') || '(none)'}`)
  }
  expect(uncovered, 'emulated endpoints without a contract scenario').toEqual([])
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
