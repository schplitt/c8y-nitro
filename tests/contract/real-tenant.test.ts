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
import { afterEach, describe, it } from 'vitest'
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
    await client!.core.fetch(`/inventory/managedObjects/${mo.id}`, { method: 'DELETE' }).catch(() => {})
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
    if (current) {
      await cleanup(current)
      current = undefined
    }
  })

  for (const scenario of scenarios) {
    it(scenario.name, async () => {
      current = `ctr${Date.now()}`
      await scenario.run({ client: client!, unique: current })
    }, 60_000)
  }
})
