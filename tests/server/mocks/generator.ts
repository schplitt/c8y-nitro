import type { ICredentials, ICurrentUser } from '@c8y/client'

/**
 * Mock data that can be configured per test
 */
export interface MockC8yClientData {
  currentUser?: ICurrentUser | null
  subscriptions?: Array<ICredentials>
  tenantOptions?: Record<string, string>
}

/**
 * Generates virtual module code for \@c8y/client mock with predefined static data
 * This is used by Nitro's virtual modules to replace \@c8y/client imports during build
 * @param data
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

  return `
/**
 * Virtual mock @c8y/client with static test data
 * This module is defined inline via Nitro's virtual modules
 */

// Mock data defined at build time
const mockCurrentUser = ${currentUserCode}
const mockSubscriptions = ${subscriptionsCode}
const mockTenantOptions = ${tenantOptionsCode}

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

  options = {
    tenant: {
      detail: async (query) => {
        const value = mockTenantOptions[query.key]
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
