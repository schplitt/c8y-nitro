// Runs the contract scenarios against a REAL Cumulocity tenant, to check that
// the c8y-nitro/testing fake behaves like the platform. Not part of `pnpm test`:
//
//   pnpm test:contract
//
// Credentials come from the environment (or .env / playground/.env, loaded
// here and never printed): C8Y_CONTRACT_BASEURL/TENANT/USER/PASSWORD, or the dev
// credentials C8Y_BASEURL + C8Y_DEVELOPMENT_TENANT/USER/PASSWORD (also with the
// C8Y_NITRO_ prefix). Every scenario's data contains a unique run id and is
// deleted afterwards.
import { existsSync } from 'node:fs'
import process from 'node:process'
import { BasicAuth, Client } from '@c8y/client'
import { createRealtimeClient } from 'c8y-realtime'
import type { RealtimeClient, WebSocketFactory } from 'c8y-realtime'
import { WebSocket } from 'ws'
import { afterEach, describe, it } from 'vitest'
import { sleep } from './helpers'
import { scenarios } from './scenarios'

for (const file of ['.env', 'playground/.env']) {
  if (existsSync(file)) {
    process.loadEnvFile(file)
  }
}

function env(...names: string[]): string | undefined {
  for (const name of names) {
    for (const prefix of ['C8Y_CONTRACT_', 'C8Y_NITRO_', 'C8Y_']) {
      const value = process.env[`${prefix}${name}`]
      if (value) {
        return value
      }
    }
  }
  return undefined
}

const baseUrl = process.env.C8Y_CONTRACT_BASEURL ?? env('BASEURL')
const credentials = {
  tenant: process.env.C8Y_CONTRACT_TENANT ?? env('DEVELOPMENT_TENANT'),
  user: process.env.C8Y_CONTRACT_USER ?? env('DEVELOPMENT_USER'),
  password: process.env.C8Y_CONTRACT_PASSWORD ?? env('DEVELOPMENT_PASSWORD'),
}
const configured = Boolean(baseUrl && credentials.tenant && credentials.user && credentials.password)

const client = configured ? new Client(new BasicAuth(credentials), baseUrl) : undefined
let current: string | undefined
const realtimeClients: RealtimeClient[] = []

/**
 * Deletes everything a scenario created (all names contain the run id).
 * @param unique
 */
async function cleanup(unique: string) {
  const { data } = await client!.inventory.list({ query: `$filter=(name eq '*${unique}*')`, pageSize: 2000 })
  for (const mo of data) {
    for (const path of [`/measurement/measurements?source=${mo.id}`, `/event/events?source=${mo.id}`, `/alarm/alarms?source=${mo.id}`, `/devicecontrol/operations?deviceId=${mo.id}`]) {
      await client!.core.fetch(path, { method: 'DELETE' }).catch(() => {})
    }
  }
  for (const mo of data) {
    // binaries can only be deleted through the binaries API
    const path = (mo as Record<string, unknown>).c8y_IsBinary !== undefined ? `/inventory/binaries/${mo.id}` : `/inventory/managedObjects/${mo.id}`
    await client!.core.fetch(path, { method: 'DELETE' }).catch(() => {})
  }
  const subscriptions = await (await client!.core.fetch('/notification2/subscriptions?pageSize=2000')).json().catch(() => ({ subscriptions: [] }))
  for (const subscription of subscriptions.subscriptions ?? []) {
    if (String(subscription.subscription).includes(unique)) {
      await client!.core.fetch(`/notification2/subscriptions/${subscription.id}`, { method: 'DELETE' }).catch(() => {})
    }
  }
}

describe.skipIf(!configured)('contract scenarios against a real tenant', () => {
  afterEach(async () => {
    await Promise.all(realtimeClients.splice(0).map((client) => client.close()))
    if (current) {
      await cleanup(current)
      current = undefined
    }
  })

  for (const scenario of scenarios) {
    it(scenario.name, async () => {
      const unique = `ctr${Date.now()}`
      current = unique
      await scenario.run({
        client: client!,
        unique,
        tenant: credentials.tenant!,
        settle: sleep,
        realtime: () => {
          const realtime = createRealtimeClient({
            baseUrl: baseUrl!,
            tenant: credentials.tenant!,
            user: credentials.user!,
            password: credentials.password!,
            name: unique,
            webSocketImpl: WebSocket as unknown as WebSocketFactory,
            subscription: { nonPersistent: true },
          })
          realtimeClients.push(realtime)
          return realtime
        },
      })
    }, 60_000)
  }
})
