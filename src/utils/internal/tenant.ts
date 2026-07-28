import { defineCachedFunction } from 'nitro/cache'
import type { H3Event } from 'nitro/h3'
import type { ServerRequest } from 'nitro/types'
import { Buffer } from 'node:buffer'
import { createHash, randomBytes } from 'node:crypto'
import { useUserClient } from '../client'

const USER_TENANT_CACHE_SALT = randomBytes(32).toString('hex')

function getCookieValue(cookieHeader: string | null, name: string): string | undefined {
  try {
    const value = cookieHeader?.match(`(^|;)\\s*${name}\\s*=\\s*([^;]+)`)
    return value ? value.pop() : undefined
  } catch {
    return undefined
  }
}

export function getCurrentUserTenantCacheKeyMaterial(requestOrEvent: ServerRequest | H3Event): string | undefined {
  const request = 'req' in requestOrEvent ? requestOrEvent.req : requestOrEvent
  const cookieAuth = getCookieValue(request.headers.get('cookie'), 'authorization')
  if (cookieAuth) {
    return `cookie:${cookieAuth}`
  }

  const authorization = request.headers.get('authorization')
  if (authorization) {
    return `header:${authorization}`
  }

  return undefined
}

export function createCurrentUserTenantCacheKey(requestOrEvent: ServerRequest | H3Event): string {
  const material = getCurrentUserTenantCacheKeyMaterial(requestOrEvent)
  if (!material) {
    throw new Error('Cannot create current user tenant cache key without auth material')
  }

  return createHash('sha256')
    .update(USER_TENANT_CACHE_SALT)
    .update(':')
    .update(material)
    .digest('hex')
}

export function tryGetTenantFromBasicAuth(requestOrEvent: ServerRequest | H3Event): string | undefined {
  const request = 'req' in requestOrEvent ? requestOrEvent.req : requestOrEvent
  const authorization = request.headers.get('authorization')

  if (!authorization?.startsWith('Basic ')) {
    return undefined
  }

  try {
    const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8')
    const separatorIndex = decoded.indexOf(':')
    const userPart = separatorIndex === -1 ? decoded : decoded.slice(0, separatorIndex)
    const slashIndex = userPart.indexOf('/')

    if (slashIndex <= 0) {
      return undefined
    }

    return userPart.slice(0, slashIndex)
  } catch {
    return undefined
  }
}

export const getCurrentUserTenantId = defineCachedFunction(
  async (requestOrEvent: ServerRequest | H3Event): Promise<string> => {
    const basicTenant = tryGetTenantFromBasicAuth(requestOrEvent)
    if (basicTenant) {
      return basicTenant
    }

    const userClient = useUserClient(requestOrEvent)

    return (await userClient.tenant.current()).data.name
  },
  {
    maxAge: 60,
    name: '_c8y_nitro_get_current_user_tenant_id',
    group: 'c8y_nitro',
    swr: false,
    getKey: (requestOrEvent) => createCurrentUserTenantCacheKey(requestOrEvent),
    shouldBypassCache: (requestOrEvent) => !getCurrentUserTenantCacheKeyMaterial(requestOrEvent),
  },
)

// Tenant domains rarely change: cached per tenant ID for 24 hours.
const cachedTenantDomain = defineCachedFunction(
  async (requestOrEvent: ServerRequest | H3Event, _tenantId: string): Promise<string> => {
    return (await useUserClient(requestOrEvent).tenant.current()).data.domainName
  },
  {
    maxAge: 86400,
    name: '_c8y_nitro_get_user_tenant_domain',
    group: 'c8y_nitro',
    swr: false,
    getKey: (_requestOrEvent, tenantId) => tenantId,
  },
)

/**
 * Resolves the public domain of the current user's tenant (e.g. `tenant.cumulocity.com`)
 * via `/tenant/currentTenant` with the user's credentials from the current request.
 * @param requestOrEvent - The H3Event or ServerRequest from the current request
 */
export async function getUserTenantDomain(requestOrEvent: ServerRequest | H3Event): Promise<string> {
  const tenantId = await getCurrentUserTenantId(requestOrEvent)
  return cachedTenantDomain(requestOrEvent, tenantId)
}
