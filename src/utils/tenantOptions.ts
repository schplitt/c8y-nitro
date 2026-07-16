import { defineCachedFunction } from 'nitro/cache'
import { useRuntimeConfig } from 'nitro/runtime-config'
import { createError } from './logging'
import type { Client } from '@c8y/client'
import type { C8YSettingsCategory, C8YTenantOptionKey } from 'c8y-nitro/types'
import { fetcherStoreKey, tenantOptionFetchers } from './internal/tenantOptionFetchers'
import type { CachedTenantOptionFetcher } from './internal/tenantOptionFetchers'

/**
 * A tenant option key for the microservice's own settings category.
 *
 * Manifest-declared keys are offered via autocomplete (from the generated
 * {@link C8YTenantOptionKey} union) while any other string is still accepted, so
 * runtime-computed keys such as `encrypted.password.${hash}` work too.
 */
export type TenantOptionKeyInput = C8YTenantOptionKey | (string & {})

/**
 * Guards a key used against a *foreign* settings category.
 *
 * `credentials.*` options are stored encrypted and can only be decrypted within
 * the owning microservice's category, so they can never be read from a different
 * category. Such keys collapse to `never`, turning the misuse into a compile error.
 */
export type ForeignTenantOptionKeyInput<K extends string> = K & (K extends `credentials.${string}` ? never : unknown)

/**
 * Options for {@link TenantOption.setEditable}.
 */
export interface SetEditableOptions {
  /**
   * The tenant whose option `editable` flag is updated.
   *
   * Required by Cumulocity: the editable-flag endpoint is only permitted from
   * the management tenant, and the target tenant must be given explicitly.
   */
  targetTenant: string
}

/**
 * Handle for a single tenant option (a `category` + `key` pair).
 *
 * Obtained via {@link useTenantOption} (own category) or
 * `useTenantOptions(category).option(key)`.
 */
export interface TenantOption {
  /**
   * Read the current value. Returns `undefined` when the option is not set
   * (Cumulocity responds `404`). The value is cached per the configured TTL.
   */
  read: () => Promise<string | undefined>
  /**
   * Create or update the option value (upsert), then invalidate the cached read.
   */
  set: (value: string) => Promise<void>
  /**
   * Read the value; if it is not set, write `fallback` and return it.
   */
  getOrInsert: (fallback: string) => Promise<string>
  /**
   * Delete the option. Idempotent — a missing option resolves without error.
   * Invalidates the cached read afterwards.
   */
  delete: () => Promise<void>
  /**
   * Update the option's `editable` flag.
   *
   * @remarks Cumulocity only allows this from the **management tenant** (role
   * `ROLE_OPTION_MANAGEMENT_ADMIN`). It will fail with `403` when called from a
   * regular subscribed-tenant microservice.
   */
  setEditable: (editable: boolean, options: SetEditableOptions) => Promise<void>
  /**
   * Invalidate the cached value, then re-read it.
   */
  refresh: () => Promise<string | undefined>
  /**
   * Invalidate the cached value (no-op if it was never read).
   */
  invalidate: () => Promise<void>
}

/**
 * Handle for all options within the microservice's own settings category.
 */
export interface TenantOptionCategory {
  /**
   * Get a handle for a single option in this category.
   */
  option: (key: TenantOptionKeyInput) => TenantOption
  /**
   * List all options set in this category as a key/value map.
   */
  list: () => Promise<Record<string, string>>
  /**
   * Create or update multiple options in this category, then invalidate their caches.
   */
  setAll: (values: Record<string, string>) => Promise<void>
  /**
   * Invalidate every already-read option cache in this category.
   */
  invalidateAll: () => Promise<void>
  /**
   * Refresh every already-read option cache in this category.
   * @returns A map of the refreshed keys to their new values.
   */
  refreshAll: () => Promise<Record<string, string | undefined>>
}

/**
 * Handle for a *foreign* settings category (one other than the microservice's own).
 *
 * Identical to {@link TenantOptionCategory} except that:
 * - `credentials.*` keys are rejected — see {@link ForeignTenantOptionKeyInput};
 * - the optional type parameter `K` sets the known key set for autocomplete
 *   (`useTenantOptions<'a' | 'b'>(client, 'other')`). It defaults to `string`,
 *   which accepts any key (still minus `credentials.*`).
 */
export interface ForeignTenantOptionCategory<K extends string = string> {
  /**
   * Get a handle for a single non-`credentials.*` option in this category.
   * Completes to `K` when a key set was provided.
   */
  option: <Key extends K>(key: ForeignTenantOptionKeyInput<Key>) => TenantOption
  /**
   * List all options set in this category as a key/value map.
   */
  list: () => Promise<Record<string, string>>
  /**
   * Create or update multiple options in this category, then invalidate their caches.
   */
  setAll: (values: Record<string, string>) => Promise<void>
  /**
   * Invalidate every already-read option cache in this category.
   */
  invalidateAll: () => Promise<void>
  /**
   * Refresh every already-read option cache in this category.
   * @returns A map of the refreshed keys to their new values.
   */
  refreshAll: () => Promise<Record<string, string | undefined>>
}

/**
 * The microservice's own settings category, resolved once from runtime config
 * (`manifest.settingsCategory` → `contextPath` → `name`). This is independent of
 * which tenant is targeted.
 */
function getOwnCategory(): string {
  return useRuntimeConfig().c8ySettingsCategory as string
}

/**
 * Resolves the tenant id a client operates on, used for per-tenant cache keys.
 *
 * Prefers the stamped `client.core.tenant` (set by the `use*Client` helpers);
 * otherwise resolves it on demand via `/tenant/currentTenant` and memoizes it
 * back onto the client.
 * @param client - The Cumulocity client
 */
async function resolveClientTenant(client: Client): Promise<string> {
  if (client.core.tenant) {
    return client.core.tenant
  }
  const res = await client.core.fetch('/tenant/currentTenant', {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  const tenant = res.ok ? (await res.json() as { name?: string } | undefined)?.name : undefined
  if (!tenant) {
    // This is not an options-permission problem — resolving the current tenant
    // should normally always succeed, so surface it as an internal error.
    // Diagnostic detail goes to `internal` (logged, never sent to the client).
    throw createError({
      status: 500,
      message: 'Could not determine the target tenant',
      fix: 'This is unexpected. Retry the request, and contact the microservice operator if it keeps happening.',
      internal: {
        reason: res.ok ? 'GET /tenant/currentTenant returned no tenant name' : 'GET /tenant/currentTenant failed',
        upstreamStatus: res.status,
      },
    })
  }
  client.core.tenant = tenant
  return tenant
}

/**
 * Builds the Cumulocity Options API path for a category (and optional key).
 * @param category - The settings category
 * @param key - The tenant option key (omit for category-level operations)
 */
function optionsPath(category: string, key?: string): string {
  const base = `/tenant/options/${encodeURIComponent(category)}`
  return key === undefined ? base : `${base}/${encodeURIComponent(key)}`
}

/**
 * Cumulocity role required to read tenant options.
 */
const OPTION_READ_ROLE = 'ROLE_OPTION_MANAGEMENT_READ'
/**
 * Cumulocity role required to create, update or delete tenant options.
 */
const OPTION_ADMIN_ROLE = 'ROLE_OPTION_MANAGEMENT_ADMIN'

/**
 * Builds a structured error for a failed Options API request.
 *
 * The exposed fields stay minimal (`message` + `status`). The operation detail —
 * upstream status, the internal endpoint/method, and the Cumulocity role it
 * needs — goes into `internal`, which is logged for debugging but never
 * serialized to the HTTP response (so it can't leak to the frontend). The raw
 * upstream response body is intentionally omitted; it is rarely useful.
 * @param status - The upstream HTTP status
 * @param message - A human-readable summary of the failed operation
 * @param internal - Backend-only debugging context (endpoint, method, required role)
 */
function optionRequestError(status: number, message: string, internal: Record<string, unknown>): Error {
  return createError({
    status: status || 500,
    message,
    internal: { upstreamStatus: status, ...internal },
  })
}

/**
 * Reads a single option value directly from the Options API.
 * Returns `undefined` when the option is not set (404).
 * @param client - The Cumulocity client (determines tenant + auth)
 * @param category - The settings category
 * @param key - The tenant option key
 */
async function fetchOptionValue(client: Client, category: string, key: string): Promise<string | undefined> {
  const endpoint = optionsPath(category, key)
  const res = await client.core.fetch(endpoint, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  if (res.status === 404) {
    return undefined
  }
  if (!res.ok) {
    throw optionRequestError(res.status, `Failed to read tenant option '${key}'`, {
      method: 'GET',
      endpoint,
      requiredRole: OPTION_READ_ROLE,
    })
  }
  const data = await res.json() as { value?: string } | undefined
  return data?.value
}

/**
 * Creates or updates a single option value (upsert) via the Options API.
 * @param client - The Cumulocity client (determines tenant + auth)
 * @param category - The settings category
 * @param key - The tenant option key
 * @param value - The value to store
 */
async function putOptionValue(client: Client, category: string, key: string, value: string): Promise<void> {
  const endpoint = optionsPath(category, key)
  const res = await client.core.fetch(endpoint, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ value }),
  })
  if (!res.ok) {
    throw optionRequestError(res.status, `Failed to set tenant option '${key}'`, {
      method: 'PUT',
      endpoint,
      requiredRole: OPTION_ADMIN_ROLE,
    })
  }
}

/**
 * Deletes a single option via the Options API. Idempotent: a 404 resolves.
 * @param client - The Cumulocity client (determines tenant + auth)
 * @param category - The settings category
 * @param key - The tenant option key
 */
async function deleteOptionValue(client: Client, category: string, key: string): Promise<void> {
  const endpoint = optionsPath(category, key)
  const res = await client.core.fetch(endpoint, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  })
  if (res.status === 404) {
    return
  }
  if (!res.ok) {
    throw optionRequestError(res.status, `Failed to delete tenant option '${key}'`, {
      method: 'DELETE',
      endpoint,
      requiredRole: OPTION_ADMIN_ROLE,
    })
  }
}

/**
 * Updates the `editable` flag of a single option (management tenant only).
 * @param client - The Cumulocity client (must be the management tenant)
 * @param category - The settings category
 * @param key - The tenant option key
 * @param editable - Whether the option may be edited
 * @param targetTenant - The tenant whose option flag is updated
 */
async function putOptionEditable(client: Client, category: string, key: string, editable: boolean, targetTenant: string): Promise<void> {
  const endpoint = `${optionsPath(category, key)}/editable`
  const res = await client.core.fetch(`${endpoint}?targetTenant=${encodeURIComponent(targetTenant)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ editable }),
  })
  if (!res.ok) {
    throw optionRequestError(res.status, `Failed to update editable flag for tenant option '${key}'`, {
      method: 'PUT',
      endpoint,
      targetTenant,
      // Requires ROLE_OPTION_MANAGEMENT_ADMIN *and* being the management tenant.
      requiredRole: `${OPTION_ADMIN_ROLE} (management tenant only)`,
    })
  }
}

/**
 * Lists all options set in a category as a key/value map.
 * @param client - The Cumulocity client (determines tenant + auth)
 * @param category - The settings category
 */
async function listCategoryOptions(client: Client, category: string): Promise<Record<string, string>> {
  const endpoint = optionsPath(category)
  const res = await client.core.fetch(endpoint, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  if (res.status === 404) {
    return {}
  }
  if (!res.ok) {
    throw optionRequestError(res.status, `Failed to list tenant options for category '${category}'`, {
      method: 'GET',
      endpoint,
      requiredRole: OPTION_READ_ROLE,
    })
  }
  // The by-category endpoint returns a flat { key: value } map.
  const data = await res.json() as Record<string, string> | undefined
  return { ...data }
}

/**
 * Gets the cache TTL for a specific tenant option key.
 * Uses per-key override if defined, otherwise falls back to the default TTL.
 * @param key - The tenant option key
 */
function getTenantOptionCacheTTL(key: string): number {
  const config = useRuntimeConfig()
  const perKeyTTL = config.c8yTenantOptionsPerKeyTTL as Record<string, number> | undefined
  return perKeyTTL?.[key] ?? (config.c8yDefaultTenantOptionsTTL as number) ?? 600
}

/**
 * Factory that creates a cached read fetcher for a specific tenant/category/key.
 * All fetchers share the same cache group so they can be invalidated together.
 * @param client - The Cumulocity client (determines tenant + auth)
 * @param tenant - The tenant id (for the cache key)
 * @param category - The settings category
 * @param key - The tenant option key
 */
function createCachedTenantOptionFetcher(client: Client, tenant: string, category: string, key: string): CachedTenantOptionFetcher {
  const storeKey = fetcherStoreKey(tenant, category, key)
  const cacheName = `_c8y_nitro_tenant_option_${storeKey.replace(/[^a-zA-Z0-9]/g, '_')}`

  // TODO: Remove this cast once Nitro's `defineCachedFunction()` types expose ocache's `.invalidate()` helper.
  const cachedFetcher = defineCachedFunction(
    async (): Promise<string | undefined> => fetchOptionValue(client, category, key),
    {
      maxAge: getTenantOptionCacheTTL(key),
      name: cacheName,
      group: 'c8y_nitro',
      swr: false,
    },
  ) as (() => Promise<string | undefined>) & {
    invalidate: () => Promise<void>
  }

  const fetcher: CachedTenantOptionFetcher = Object.assign(cachedFetcher, {
    refresh: async (): Promise<string | undefined> => {
      await cachedFetcher.invalidate()
      return await cachedFetcher()
    },
  })

  return fetcher
}

/**
 * Gets or creates the cached read fetcher for a tenant/category/key triple.
 * @param client - The Cumulocity client (determines tenant + auth)
 * @param tenant - The resolved tenant id
 * @param category - The settings category
 * @param key - The tenant option key
 */
function getOrCreateFetcher(client: Client, tenant: string, category: string, key: string): CachedTenantOptionFetcher {
  const storeKey = fetcherStoreKey(tenant, category, key)
  let fetcher = tenantOptionFetchers[storeKey]
  if (!fetcher) {
    fetcher = createCachedTenantOptionFetcher(client, tenant, category, key)
    tenantOptionFetchers[storeKey] = fetcher
  }
  return fetcher
}

/**
 * Invalidates the cached read for a store key, if one has been created.
 * @param storeKey - The composite `${tenant}::${category}::${key}` store key
 */
async function invalidateStoreKey(storeKey: string): Promise<void> {
  const fetcher = tenantOptionFetchers[storeKey]
  if (fetcher) {
    await fetcher.invalidate()
  }
}

/**
 * Invalidates every created fetcher whose store key matches the predicate.
 * @param predicate - Selects store keys to invalidate
 */
async function invalidateFetchers(predicate: (storeKey: string) => boolean): Promise<void> {
  await Promise.all(
    Object.entries(tenantOptionFetchers)
      .filter(([storeKey]) => predicate(storeKey))
      .map(([, fetcher]) => fetcher.invalidate()),
  )
}

/**
 * Refreshes every created fetcher whose store key matches the predicate.
 * @param predicate - Selects store keys to refresh
 * @returns Map of matched store keys to their refreshed values
 */
async function refreshFetchers(predicate: (storeKey: string) => boolean): Promise<Record<string, string | undefined>> {
  const entries = Object.entries(tenantOptionFetchers).filter(([storeKey]) => predicate(storeKey))
  const values = await Promise.all(entries.map(([, fetcher]) => fetcher.refresh()))
  return Object.fromEntries(entries.map(([storeKey], i) => [storeKey, values[i]]))
}

/**
 * Builds a single-option handle for a client/category/key.
 * @param client - The Cumulocity client (determines tenant + auth)
 * @param category - The settings category
 * @param key - The tenant option key
 */
function makeTenantOption(client: Client, category: string, key: string): TenantOption {
  const currentStoreKey = async (): Promise<string> =>
    fetcherStoreKey(await resolveClientTenant(client), category, key)

  const readFetcher = async (): Promise<CachedTenantOptionFetcher> =>
    getOrCreateFetcher(client, await resolveClientTenant(client), category, key)

  return {
    read: async () => (await readFetcher())(),
    set: async (value: string): Promise<void> => {
      await putOptionValue(client, category, key, value)
      await invalidateStoreKey(await currentStoreKey())
    },
    getOrInsert: async (fallback: string): Promise<string> => {
      const current = await (await readFetcher())()
      if (current !== undefined) {
        return current
      }
      await putOptionValue(client, category, key, fallback)
      await invalidateStoreKey(await currentStoreKey())
      return fallback
    },
    delete: async (): Promise<void> => {
      await deleteOptionValue(client, category, key)
      await invalidateStoreKey(await currentStoreKey())
    },
    setEditable: async (editable: boolean, options: SetEditableOptions): Promise<void> => {
      await putOptionEditable(client, category, key, editable, options.targetTenant)
      await invalidateStoreKey(await currentStoreKey())
    },
    refresh: async () => (await readFetcher()).refresh(),
    invalidate: async () => invalidateStoreKey(await currentStoreKey()),
  }
}

/**
 * Builds a category handle. The runtime shape is identical for the own and
 * foreign categories; the public overloads differ only at the type level.
 * @param client - The Cumulocity client (determines tenant + auth)
 * @param category - The settings category
 */
function makeTenantOptionCategory(client: Client, category: string): TenantOptionCategory {
  const categoryPrefix = async (): Promise<string> => `${await resolveClientTenant(client)}::${category}::`

  return {
    option: (key: string) => makeTenantOption(client, category, key),
    list: () => listCategoryOptions(client, category),
    setAll: async (values: Record<string, string>): Promise<void> => {
      const entries = Object.entries(values)
      await Promise.all(entries.map(([key, value]) => putOptionValue(client, category, key, value)))
      const tenant = await resolveClientTenant(client)
      await Promise.all(entries.map(([key]) => invalidateStoreKey(fetcherStoreKey(tenant, category, key))))
    },
    invalidateAll: async (): Promise<void> => {
      const prefix = await categoryPrefix()
      await invalidateFetchers((storeKey) => storeKey.startsWith(prefix))
    },
    refreshAll: async (): Promise<Record<string, string | undefined>> => {
      const prefix = await categoryPrefix()
      const refreshed = await refreshFetchers((storeKey) => storeKey.startsWith(prefix))
      // Return keys relative to the category (strip the `${tenant}::${category}::` prefix).
      return Object.fromEntries(
        Object.entries(refreshed).map(([storeKey, value]) => [storeKey.slice(prefix.length), value]),
      )
    },
  }
}

/**
 * Gets a handle for a single tenant option in the microservice's **own** settings
 * category, targeting the tenant of the given `client`.\
 * Reads are cached per tenant, using the client's service user credentials.
 *
 * This is a shortcut for `useTenantOptions(client).option(key)` — it only drops
 * the category argument. For a single option in a **foreign** category, use
 * `useTenantOptions(client, category).option(key)`.
 *
 * Manifest-declared keys are offered via autocomplete, but any dynamic string
 * is accepted too (e.g. `encrypted.password.${hash}`).
 *
 * @param client - The Cumulocity client that determines the target tenant
 * @param key - The tenant option key
 *
 * @config Cache TTL can be configured via:
 * - `c8y.cache.defaultTenantOptionsTTL` — Default TTL for all keys (in seconds)
 * - `c8y.cache.tenantOptions` — Per-key TTL overrides
 * - `NITRO_C8Y_DEFAULT_TENANT_OPTIONS_TTL` — Environment variable for default TTL
 *
 * @example
 * // Read the owner tenant's config:
 * const value = await useTenantOption(await useDeployedTenantClient(), 'featureMode').read()
 *
 * // Read the current request tenant's config (multi-tenant):
 * const value = await useTenantOption(await useUserTenantClient(event), 'featureMode').read()
 *
 * // Create or update, or seed a dynamic key:
 * await useTenantOption(client, 'featureMode').set('advanced')
 * const token = await useTenantOption(client, `encrypted.password.${hash}`).getOrInsert('')
 */
export function useTenantOption(client: Client, key: TenantOptionKeyInput): TenantOption {
  return makeTenantOption(client, getOwnCategory(), key)
}

/**
 * @internal
 */
interface UseTenantOptions {
  /**
   * Handle for the client tenant's own settings category.
   */
  (client: Client): TenantOptionCategory
  /**
   * Handle for the client tenant's own settings category (given explicitly).
   */
  (client: Client, category: C8YSettingsCategory): TenantOptionCategory
  /**
   * Handle for a foreign settings category (`credentials.*` keys are rejected).
   *
   * Provide the key set as a type argument for autocomplete, e.g.
   * `useTenantOptions<'featureA' | 'featureB'>(client, 'other-service')`.
   * Supplying a type argument also explicitly selects this overload.
   */
  <K extends string = string>(client: Client, category: string): ForeignTenantOptionCategory<K>
  /**
   * Invalidate every already-read option cache, across all tenants and categories.
   */
  invalidateAll: () => Promise<void>
  /**
   * Refresh every already-read option cache, across all tenants and categories.
   * @returns Map of `${tenant}::${category}::${key}` store keys to their refreshed values.
   */
  refreshAll: () => Promise<Record<string, string | undefined>>
}

const useTenantOptionsBase = ((client: Client, category?: string): TenantOptionCategory =>
  makeTenantOptionCategory(client, category ?? getOwnCategory())) as UseTenantOptions

/**
 * Gets a handle for a whole settings category, targeting the tenant of the given
 * `client`.\
 * Omit the category (or pass the own {@link C8YSettingsCategory}) for the
 * microservice's own category; pass any other category to read/write options in
 * a foreign category (where `credentials.*` keys are rejected).
 *
 * @param client - The Cumulocity client that determines the target tenant
 *
 * @example
 * const client = await useUserTenantClient(event)
 *
 * // Own category:
 * const values = await useTenantOptions(client).list()
 * await useTenantOptions(client).option('featureMode').set('advanced')
 *
 * // Foreign category:
 * const value = await useTenantOptions(client, 'other-service').option('someKey').read()
 *
 * // Invalidate all cached options of one tenant + category:
 * await useTenantOptions(client, 'other-service').invalidateAll()
 *
 * // Invalidate everything, across all tenants and categories:
 * await useTenantOptions.invalidateAll()
 */
export const useTenantOptions: UseTenantOptions = Object.assign(useTenantOptionsBase, {
  invalidateAll: (): Promise<void> => invalidateFetchers(() => true),
  refreshAll: (): Promise<Record<string, string | undefined>> => refreshFetchers(() => true),
})
