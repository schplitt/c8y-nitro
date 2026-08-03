import { Client } from '@c8y/client'
import type { ICredentials } from '@c8y/client'
import { createRealtimeClient } from 'c8y-realtime'
import type { ConsumerResilienceOptions, RealtimeClient, SubscriptionApi } from 'c8y-realtime'
import { useSubscribedTenantCredentials } from './credentials'
import { getCurrentUserTenantId } from './internal/tenant'
import { createError } from './logging'
import { useRuntimeConfig } from 'nitro/runtime-config'
import { useNitroHooks } from 'nitro/app'
import process from 'node:process'
import type { H3Event } from 'nitro/h3'
import type { ServerRequest } from 'nitro/types'

/**
 * Anything a caller might already have on hand that identifies a tenant, from
 * which {@link useTenantRealtimeClient} resolves the tenant's service
 * credentials: a tenant id, that tenant's credentials, a `@c8y/client` scoped to
 * it, or the current request.
 */
export type TenantRealtimeInput = string | ICredentials | Client | H3Event | ServerRequest

/**
 * The realtime client config resolved once at build time (see
 * `setupRuntimeConfig`) and shared by every pooled client.
 */
interface ResolvedRealtimeConfig {
  name: string
  autoAck: boolean
  dedupe: boolean
  autoStart: boolean
  deleteSubscriptionOnEmpty: boolean
  deleteSubscriptionsOnClose: boolean
  subscription?: { apis?: SubscriptionApi[], nonPersistent?: boolean }
  resilience?: ConsumerResilienceOptions
}

// How often to sweep for pooled clients that have gone unhealthy (a consumer
// stopped because its credentials ran out) and try to repair them.
const REPAIR_SWEEP_INTERVAL_MS = 30_000

// One RealtimeClient per subscribed tenant, created lazily and reused. Creation
// is synchronous (`createRealtimeClient` returns immediately; the socket opens
// in the background), so the get-check-create-set block in
// `useTenantRealtimeClient` runs without an `await` and cannot double-create for
// concurrent callers of the same tenant.
const pool = new Map<string, RealtimeClient>()

let lifecycleWired = false
let sweepTimer: ReturnType<typeof setInterval> | undefined
let sweeping = false

function realtimeConfig(): ResolvedRealtimeConfig {
  return useRuntimeConfig().c8yRealtime as ResolvedRealtimeConfig
}

/**
 * Distinguish tenant credentials from a request. Every field on `ICredentials`
 * is optional, so a bare `'password' in x` doesn't narrow the union — this
 * predicate does. A request never carries `user`/`password`/`tenant`.
 * @param input - A value already narrowed to credentials or a request.
 */
function isCredentials(input: ICredentials | H3Event | ServerRequest): input is ICredentials {
  return 'user' in input || 'password' in input || 'tenant' in input
}

/**
 * Shape c8y-nitro's `ICredentials` into the single-tenant credentials
 * `c8y-realtime` expects (it needs the `baseUrl`, which lives in the env).
 * @param tenantId - The tenant the credentials belong to.
 * @param creds - The tenant's service credentials.
 */
function toLibCredentials(tenantId: string, creds: ICredentials) {
  return {
    baseUrl: process.env.C8Y_BASEURL!,
    tenant: creds.tenant ?? tenantId,
    user: creds.user!,
    password: creds.password!,
  }
}

function createRealtimeClientForTenant(tenantId: string, creds: ICredentials): RealtimeClient {
  return createRealtimeClient({
    ...realtimeConfig(),
    ...toLibCredentials(tenantId, creds),
    // Background lifecycle runs outside a request, so the request-scoped
    // `useLogger` is unavailable here; `console` matches the lib's Logger shape.
    logger: console,
  })
}

async function subscribedCredsFor(tenantId: string): Promise<ICredentials> {
  const creds = (await useSubscribedTenantCredentials())[tenantId]
  if (!creds) {
    throw createError({
      status: 500,
      message: `No subscribed tenant credentials found for tenant '${tenantId}'`,
    })
  }
  return creds
}

async function resolveTenant(input: TenantRealtimeInput): Promise<{ tenantId: string, creds: ICredentials }> {
  // A tenant id → look up its subscribed service credentials.
  if (typeof input === 'string') {
    return { tenantId: input, creds: await subscribedCredsFor(input) }
  }

  // A @c8y/client → its stamped tenant, else ask the platform, then look up creds.
  if (input instanceof Client) {
    const tenantId = input.core.tenant ?? (await input.tenant.current()).data.name
    if (!tenantId) {
      throw createError({ status: 500, message: 'Could not resolve a tenant id from the provided client' })
    }
    return { tenantId, creds: await subscribedCredsFor(tenantId) }
  }

  // Credentials in hand → use them directly (tenant id is on the credentials).
  if (isCredentials(input)) {
    const tenantId = input.tenant
    if (!tenantId) {
      throw createError({ status: 500, message: 'The provided credentials have no tenant' })
    }
    return { tenantId, creds: input }
  }

  // The current request → resolve the caller's tenant, then its service creds
  // (never the user's auth — Notification 2.0 ignores RBAC).
  const tenantId = await getCurrentUserTenantId(input)
  return { tenantId, creds: await subscribedCredsFor(tenantId) }
}

/**
 * Repair pooled clients that have gone unhealthy — a consumer stopped because
 * its credentials ran out (rotation) or were revoked and later reissued
 * (unsubscribe → resubscribe). `RealtimeClient.updateCredentials` may only be
 * called while a client is unhealthy and validates the new creds with a probe,
 * so this is the trigger that actually performs the repair.
 *
 * Cheap when nothing is wrong: it only forces a credential refresh when there is
 * an unhealthy client whose tenant is still subscribed (so its stored creds may
 * be stale). A client whose tenant is gone is left idle — its handlers are kept
 * for a possible return, and no platform call is made on its behalf.
 */
async function repairUnhealthyClients(): Promise<void> {
  if (sweeping) {
    return
  }
  sweeping = true
  try {
    const cached = await useSubscribedTenantCredentials()
    const repairable = [...pool].filter(([tenantId, client]) => !client.healthy && cached[tenantId])
    if (repairable.length === 0) {
      return
    }

    // At least one unhealthy client whose tenant is still subscribed: its cached
    // creds may be stale (rotation), so refresh once to get the latest.
    const fresh = await useSubscribedTenantCredentials.refresh()
    for (const [tenantId, client] of repairable) {
      const creds = fresh[tenantId]
      if (!creds) {
        continue // unsubscribed after all → leave the client idle with its handlers
      }
      try {
        await client.updateCredentials(toLibCredentials(tenantId, creds))
      } catch (error) {
        // Creds still don't authenticate, or the client raced back to healthy —
        // leave it for the next sweep.
        console.error(`c8y-nitro realtime: could not repair client for tenant '${tenantId}'`, error)
      }
    }
  } finally {
    sweeping = false
  }
}

/**
 * Wire the realtime lifecycle exactly once, on first client creation. There is
 * nothing to manage until a client exists, so lazy wiring loses nothing and
 * keeps the pool a single module instance (no separately-bundled plugin, so no
 * duplicated pool). The `close` handler registers after any user handlers, which
 * is the order we want: user code does its final work while clients are alive,
 * then we tear the sockets down.
 */
function ensureLifecycleWired(): void {
  if (lifecycleWired) {
    return
  }
  lifecycleWired = true

  sweepTimer = setInterval(() => {
    repairUnhealthyClients().catch((error) => {
      console.error('c8y-nitro realtime: repair sweep failed', error)
    })
  }, REPAIR_SWEEP_INTERVAL_MS)
  // The sweep must not keep the process alive on its own.
  sweepTimer.unref?.()

  useNitroHooks().hook('close', async () => {
    if (sweepTimer) {
      clearInterval(sweepTimer)
      sweepTimer = undefined
    }
    // Close sockets so shutdown leaks nothing; remote subscriptions are kept.
    await Promise.all([...pool.values()].map((client) => client.close().catch(() => {})))
    pool.clear()
  })
}

/**
 * Get the pooled Notification 2.0 realtime client for a tenant, creating it on
 * first use and reusing it after. Accepts whatever identifies the tenant — a
 * tenant id, that tenant's credentials, a `@c8y/client`, or the current request
 * — and always connects with the tenant's **service** credentials.
 *
 * Register handlers directly on the returned client (see `c8y-realtime`):
 * @example
 * const rt = await useTenantRealtimeClient(event)
 * rt.alarms.onCreate('*', alarm => log.info(alarm.severity, alarm.text))
 * rt.measurements.onCreate('device42', m => log.info(m.type, m.time))
 * @param input - A tenant id, `ICredentials`, a `Client`, or an `H3Event`/`ServerRequest`.
 */
export async function useTenantRealtimeClient(input: TenantRealtimeInput): Promise<RealtimeClient> {
  const { tenantId, creds } = await resolveTenant(input)
  ensureLifecycleWired()

  // Synchronous from here → atomic get-or-create, no double-create race.
  let client = pool.get(tenantId)
  if (!client) {
    client = createRealtimeClientForTenant(tenantId, creds)
    pool.set(tenantId, client)
  }
  return client
}
