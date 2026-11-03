/**
 * Contract scenarios for the c8y-nitro/testing fake tenant.
 *
 * Each scenario talks to "a Cumulocity tenant" through the real \@c8y/client
 * and asserts platform behavior the fake emulates. They run against the fake
 * in CI (tests/server/contract.test.ts). They only use a `Client` and create
 * their own uniquely named data, so the same scenarios can later run against a
 * real tenant to verify the fake. When a scenario fails there, the fake is
 * wrong.
 */
import type { Client } from '@c8y/client'
import type { RealtimeClient } from 'c8y-realtime'

export interface ContractContext {
  client: Client
  /**
   * Unique per scenario run, to keep data apart on a shared tenant.
   */
  unique: string
  /**
   * Tenant id of the credentials.
   */
  tenant: string
  /**
   * A c8y-realtime client for the same tenant and user (closed after the
   * scenario). Against the fake it uses the fake tenant's WebSocket.
   */
  realtime: () => RealtimeClient
  /**
   * Waits for a write the platform applies asynchronously before asserting
   * that nothing changed (a negative wait). The fake applies writes at once,
   * so its runner shortens the wait.
   */
  settle: (ms: number) => Promise<void>
}

export interface ContractScenario {
  name: string
  /**
   * Ids of the platform behaviors this scenario checks, as listed in
   * docs/reference/platform-behavior.md (tests/unit/platform-behavior.test.ts
   * keeps the list and the scenarios in sync).
   */
  verifies?: string[]
  run: (context: ContractContext) => Promise<void>
}

export async function rejection(promise: Promise<unknown>): Promise<{ res: { status: number }, data?: { error?: string } }> {
  try {
    await promise
  } catch (error) {
    return error as { res: { status: number }, data?: { error?: string } }
  }
  throw new Error('expected the request to fail')
}

/**
 * Retries an assertion for a few seconds: some platform writes (bulk deletes)
 * apply asynchronously on a real tenant. The fake applies them immediately.
 * @param assertion
 * @param timeout
 */
export async function eventually(assertion: () => Promise<void>, timeout = 5000): Promise<void> {
  const start = Date.now()
  for (;;) {
    try {
      return await assertion()
    } catch (error) {
      if (Date.now() - start > timeout) {
        throw error
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 250)
      })
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export const time = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 10, minutes)).toISOString()
