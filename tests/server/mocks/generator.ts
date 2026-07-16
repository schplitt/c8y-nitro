import type { ICredentials, ICurrentUser } from '@c8y/client'

/**
 * Mock data that can be configured per test
 */
export interface MockC8yClientData {
  currentUser?: ICurrentUser | null
  subscriptions?: Array<ICredentials>
  /**
   * Options for the microservice's own category. Stored under a wildcard bucket
   * so category-agnostic reads (and the `__*MockTenantOption` helpers) resolve
   * them regardless of the resolved own-category name.
   */
  tenantOptions?: Record<string, string>
  /**
   * Options keyed by explicit category — use this to seed foreign categories.
   */
  tenantOptionsByCategory?: Record<string, Record<string, string>>
}

/**
 * Generates virtual module code for \@c8y/client mock with predefined test data.
 * This is used by Nitro's virtual modules to replace \@c8y/client imports during build.
 *
 * The generated mock keeps subscriptions and tenant options in mutable module state so
 * fixture routes can simulate changing server-side data and exercise cache expiration,
 * invalidation, and lifecycle hook behavior.
 *
 * Tenant options are served through a mock `client.core.fetch()` that emulates the
 * Cumulocity Options REST API (`/tenant/options/{category}[/{key}][/editable]`),
 * matching the raw-fetch implementation in `utils/tenantOptions.ts`.
 *
 * @param data - Mock data to be returned by the Client methods (currentUser, subscriptions, tenantOptions)
 */
export function generateMockClientCode(data: MockC8yClientData = {}): string {
  const currentUserCode = data.currentUser
    ? JSON.stringify(data.currentUser, null, 2)
    : 'null'

  const subscriptionsCode = data.subscriptions
    ? `[${data.subscriptions.map((s) => JSON.stringify(s)).join(', ')}]`
    : '[]'

  const tenantOptionsCode = data.tenantOptions
    ? JSON.stringify(data.tenantOptions, null, 2)
    : '{}'

  const tenantOptionsByCategoryCode = data.tenantOptionsByCategory
    ? JSON.stringify(data.tenantOptionsByCategory, null, 2)
    : '{}'

  return `
/**
 * Virtual mock @c8y/client with static test data
 * This module is defined inline via Nitro's virtual modules
 */

// Mock data defined at build time
const mockCurrentUser = ${currentUserCode}
const mockSubscriptions = ${subscriptionsCode}

// Own-category options live under a wildcard bucket; foreign categories are keyed explicitly.
const WILDCARD = '*'
const mockOptionStore = {
  [WILDCARD]: ${tenantOptionsCode},
  ...${tenantOptionsByCategoryCode},
}
// editable flags keyed by \`\${category}::\${key}\`
const mockEditableFlags = {}

function resolveOptionValue(category, key) {
  const bucket = mockOptionStore[category]
  if (bucket && Object.prototype.hasOwnProperty.call(bucket, key)) {
    return bucket[key]
  }
  const wildcard = mockOptionStore[WILDCARD]
  if (wildcard && Object.prototype.hasOwnProperty.call(wildcard, key)) {
    return wildcard[key]
  }
  return undefined
}

function writeOptionValue(category, key, value) {
  (mockOptionStore[category] ??= {})[key] = value
}

function removeOptionValue(category, key) {
  const bucket = mockOptionStore[category]
  const existedInBucket = bucket && Object.prototype.hasOwnProperty.call(bucket, key)
  if (existedInBucket) {
    delete bucket[key]
  }
  const wildcard = mockOptionStore[WILDCARD]
  const existedInWildcard = wildcard && Object.prototype.hasOwnProperty.call(wildcard, key)
  if (existedInWildcard) {
    delete wildcard[key]
  }
  return existedInBucket || existedInWildcard
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  }
}

export function __setMockSubscription(subscription) {
  const index = mockSubscriptions.findIndex((item) => item.tenant === subscription.tenant)

  if (index === -1) {
    mockSubscriptions.push(subscription)
    return
  }

  mockSubscriptions[index] = subscription
}

export function __deleteMockSubscription(tenant) {
  const index = mockSubscriptions.findIndex((item) => item.tenant === tenant)

  if (index !== -1) {
    mockSubscriptions.splice(index, 1)
  }
}

export function __getMockSubscriptions() {
  return mockSubscriptions.map((subscription) => ({ ...subscription }))
}

export function __setMockTenantOption(key, value, category = WILDCARD) {
  writeOptionValue(category, key, value)
}

export function __deleteMockTenantOption(key, category = WILDCARD) {
  removeOptionValue(category, key)
}

export function __getMockTenantOption(key, category = WILDCARD) {
  return resolveOptionValue(category, key)
}

export function __getMockEditableFlag(category, key) {
  return mockEditableFlags[category + '::' + key]
}

/**
 * Mock BasicAuth class
 */
export class BasicAuth {
  credentials
  constructor(credentials) {
    this.credentials = credentials
  }
}

/**
 * Mock MicroserviceClientRequestAuth class
 */
export class MicroserviceClientRequestAuth {
  headers
  constructor(headers) {
    this.headers = headers
  }
}

/**
 * Mock Client class
 */
export class Client {
  core = {
    tenant: 't12345',
    fetch: async (url, init = {}) => {
      const method = String(init.method || 'GET').toUpperCase()
      const [rawPath] = String(url).split('?')
      const parts = rawPath.replace(/^\\/+/, '').split('/').filter(Boolean)
      // Expected: ['tenant', 'options', <category>, <key?>, 'editable'?]
      const category = parts[2] !== undefined ? decodeURIComponent(parts[2]) : ''
      const key = parts[3] !== undefined ? decodeURIComponent(parts[3]) : undefined
      const isEditable = parts[4] === 'editable'

      let body
      try {
        body = init.body ? JSON.parse(init.body) : undefined
      } catch (e) {
        body = undefined
      }

      // /tenant/options/{category}/{key}/editable
      if (isEditable && key !== undefined) {
        if (method === 'PUT') {
          mockEditableFlags[category + '::' + key] = !!(body && body.editable)
          return jsonResponse(200, { editable: !!(body && body.editable) })
        }
        return jsonResponse(405, undefined)
      }

      // /tenant/options/{category}/{key}
      if (key !== undefined) {
        if (method === 'GET') {
          const value = resolveOptionValue(category, key)
          if (value === undefined) {
            return jsonResponse(404, { message: 'Not Found' })
          }
          return jsonResponse(200, { category, key, value })
        }
        if (method === 'PUT') {
          writeOptionValue(category, key, body ? body.value : undefined)
          return jsonResponse(200, { category, key, value: body ? body.value : undefined })
        }
        if (method === 'DELETE') {
          const existed = removeOptionValue(category, key)
          return existed ? jsonResponse(204, undefined) : jsonResponse(404, { message: 'Not Found' })
        }
        return jsonResponse(405, undefined)
      }

      // /tenant/options/{category}
      if (method === 'GET') {
        return jsonResponse(200, { ...(mockOptionStore[category] || {}) })
      }
      if (method === 'PUT') {
        for (const [k, v] of Object.entries(body || {})) {
          writeOptionValue(category, k, v)
        }
        return jsonResponse(200, { ...(mockOptionStore[category] || {}) })
      }
      return jsonResponse(405, undefined)
    },
  }

  options = {
    tenant: {
      detail: async (query) => {
        const value = resolveOptionValue(query.category ?? WILDCARD, query.key)
        if (value === undefined) {
          const error = new Error('Not Found')
          error.status = 404
          error.res = { status: 404 }
          throw error
        }
        return {
          data: { value },
        }
      },
    },
  }

  user = {
    currentWithEffectiveRoles: async () => {
      if (!mockCurrentUser) {
        return {
          res: { ok: false, status: 404, statusText: 'Not Found' },
          data: null,
        }
      }
      return {
        res: { ok: true, status: 200, statusText: 'OK' },
        data: mockCurrentUser,
      }
    },
  }

  static getMicroserviceSubscriptions = async () => {
    return mockSubscriptions
  }

  constructor(auth, _baseUrl) {
    // Extract tenant ID from BasicAuth credentials
    if (auth && 'credentials' in auth && auth.credentials.tenant) {
      this.core.tenant = auth.credentials.tenant
    }
    // Extract tenant ID from MicroserviceClientRequestAuth headers (Basic auth: tenant/user:password)
    else if (auth && 'headers' in auth && auth.headers.authorization) {
      const basic = auth.headers.authorization.replace('Basic ', '')
      try {
        const decoded = atob(basic)
        const tenant = decoded.split('/')[0]
        if (tenant) this.core.tenant = tenant
      } catch (e) {
        // ignore decode errors
      }
    }
  }
}
`
}
