import type { ICredentials, ICurrentUser } from '@c8y/client'
import { mockData } from './db.mjs'

/**
 * Mock data is imported from external db.mjs
 * Since db.mjs is externalized, both test and server share the same instance
 */

/**
 * Mock BasicAuth class
 */
export class BasicAuth {
  credentials: ICredentials
  constructor(credentials: ICredentials) {
    this.credentials = credentials
  }
}

/**
 * Mock MicroserviceClientRequestAuth class
 */
export class MicroserviceClientRequestAuth {
  headers: Record<string, string>
  constructor(headers: Record<string, string>) {
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
      if (!mockData.currentUser) {
        return {
          res: { ok: false, status: 404, statusText: 'Not Found' },
          data: null,
        }
      }
      return {
        res: { ok: true, status: 200, statusText: 'OK' },
        data: mockData.currentUser,
      }
    },
  }

  options = {
    tenant: {
      detail: async (query: { key: string, category: string }) => {
        const value = mockData.tenantOptions.get(query.key)
        if (value === undefined) {
          const error: any = new Error('Not Found')
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
    return Array.from(mockData.subscriptions.values())
  }

  constructor(auth: any, _baseUrl: string) {
    // Extract tenant ID from auth if it's a BasicAuth with credentials
    if (auth && 'credentials' in auth && auth.credentials.tenant) {
      this.core.tenant = auth.credentials.tenant
    }
  }
}

/**
 * Test utilities for setting/clearing mock data
 */
// Re-export types from real @c8y/client (for type compatibility)
export type { ICredentials, ICurrentUser, IRole } from '@c8y/client'

/**
 * Test utilities for setting/clearing mock data
 * Import these in tests to control mock behavior
 */
export const mockUtils = {
  /**
   * Set mock subscribed tenant credentials
   * @param tenantId
   * @param credentials
   */
  setMockSubscribedTenant(tenantId: string, credentials: Omit<ICredentials, 'tenant'>) {
    mockData.subscriptions.set(tenantId, {
      ...credentials,
      tenant: tenantId,
    } as ICredentials)
  },

  /**
   * Set multiple mock subscribed tenants at once
   * @param tenants
   */
  setMockSubscribedTenants(tenants: Record<string, Omit<ICredentials, 'tenant'>>) {
    mockData.subscriptions.clear()
    for (const [tenantId, creds] of Object.entries(tenants)) {
      mockUtils.setMockSubscribedTenant(tenantId, creds)
    }
  },

  /**
   * Clear all mock subscribed tenants
   */
  clearMockSubscribedTenants() {
    mockData.subscriptions.clear()
  },

  /**
   * Set the mock current user
   * @param user
   */
  setMockCurrentUser(user: ICurrentUser) {
    mockData.currentUser = user
  },

  /**
   * Set a mock tenant option value
   * @param key
   * @param value
   */
  setMockTenantOption(key: string, value: string) {
    mockData.tenantOptions.set(key, value)
  },

  /**
   * Set multiple mock tenant options at once
   * @param options
   */
  setMockTenantOptions(options: Record<string, string>) {
    mockData.tenantOptions.clear()
    for (const [key, value] of Object.entries(options)) {
      mockData.tenantOptions.set(key, value)
    }
  },

  /**
   * Clear all mock tenant options
   */
  clearMockTenantOptions() {
    mockData.tenantOptions.clear()
  },

  /**
   * Get current mock subscriptions (for debugging)
   */
  getMockSubscriptions() {
    return Object.fromEntries(mockData.subscriptions)
  },

  /**
   * Get current mock tenant options (for debugging)
   */
  getMockTenantOptions() {
    return Object.fromEntries(mockData.tenantOptions)
  },

  /**
   * Reset all mock data (call in beforeEach)
   */
  reset() {
    mockUtils.clearMockSubscribedTenants()
    mockUtils.clearMockTenantOptions()
    mockData.currentUser = null
  },
}
