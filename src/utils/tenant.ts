import { defineCachedFunction } from 'nitro/cache'
import type { H3Event } from 'nitro/h3'
import type { ServerRequest } from 'nitro/types'
import { useRuntimeConfig } from 'nitro/runtime-config'
import { getCurrentUserTenantId } from './internal/tenant'
import { useUserClient } from './client'

// Cached per tenant ID: the domain of a tenant rarely changes, so a single
// `/tenant/currentTenant` round-trip per tenant per TTL is enough.
const cachedTenantDomain = defineCachedFunction(
  async (requestOrEvent: ServerRequest | H3Event, _tenantId: string): Promise<string> => {
    const client = useUserClient(requestOrEvent)
    return (await client.tenant.current()).data.domainName
  },
  {
    maxAge: useRuntimeConfig().c8yTenantDomainCacheTTL ?? 86400,
    name: '_c8y_nitro_get_tenant_domain',
    group: 'c8y_nitro',
    swr: false,
    getKey: (_requestOrEvent, tenantId) => tenantId,
  },
)

/**
 * Resolves the public domain of the current user's tenant (e.g. `tenant.cumulocity.com`).\
 * Uses the user's credentials from the current request to query `/tenant/currentTenant`.\
 * Results are cached per tenant ID based on the configured TTL (default: 24 hours).
 * @param requestOrEvent - The H3Event or ServerRequest from the current request
 * @returns The domain name of the user's tenant
 * @config Cache TTL can be configured via:
 * - `c8y.cache.tenantDomainTTL` in the Nitro config (value in seconds)
 * - `NITRO_C8Y_TENANT_DOMAIN_CACHE_TTL` environment variable
 * @example
 * // In a request handler:
 * const domain = await useUserTenantDomain(event)
 * const publicUrl = `https://${domain}/service/my-service`
 */
export async function useUserTenantDomain(requestOrEvent: ServerRequest | H3Event): Promise<string> {
  const tenantId = await getCurrentUserTenantId(requestOrEvent)
  return cachedTenantDomain(requestOrEvent, tenantId)
}
