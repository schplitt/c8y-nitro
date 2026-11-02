import type { ICredentials, ICurrentUser } from '@c8y/client'

/**
 * Seed data for the mocked `@c8y/client` in server tests.
 */
export interface MockC8yClientData {
  /**
   * User returned by `client.user.currentWithEffectiveRoles()`. `null` → 404.
   */
  currentUser?: ICurrentUser | null
  /**
   * Tenants returned by `Client.getMicroserviceSubscriptions()`.
   */
  subscriptions?: ICredentials[]
  /**
   * Options for the microservice's own category. Stored under a wildcard bucket
   * so reads resolve them regardless of the resolved own-category name.
   */
  tenantOptions?: Record<string, string>
  /**
   * Options keyed by explicit category, e.g. to seed foreign categories.
   */
  tenantOptionsByCategory?: Record<string, Record<string, string>>
}

const WILDCARD = '*'

/**
 * Mutable backend state of the mocked `@c8y/client`.
 *
 * Nitro's Vitest environment runs the server in the same module graph as the
 * test file (one app per test file), so tests can change this state directly
 * to simulate backend changes, e.g. to exercise cache expiry or lifecycle hooks.
 */
export const c8yMock = {
  currentUser: null as ICurrentUser | null,
  subscriptions: [] as ICredentials[],
  options: { [WILDCARD]: {} } as Record<string, Record<string, string>>,
  editableFlags: {} as Record<string, boolean>,

  seed(data: MockC8yClientData = {}) {
    this.currentUser = data.currentUser ?? null
    this.subscriptions = (data.subscriptions ?? []).map((subscription) => ({ ...subscription }))
    this.options = {
      [WILDCARD]: { ...data.tenantOptions },
      ...structuredClone(data.tenantOptionsByCategory ?? {}),
    }
    this.editableFlags = {}
  },

  setSubscription(subscription: ICredentials) {
    const index = this.subscriptions.findIndex((item) => item.tenant === subscription.tenant)
    if (index === -1) {
      this.subscriptions.push(subscription)
    } else {
      this.subscriptions[index] = subscription
    }
  },

  deleteSubscription(tenant: string) {
    this.subscriptions = this.subscriptions.filter((item) => item.tenant !== tenant)
  },

  getOption(category: string, key: string): string | undefined {
    const bucket = this.options[category]
    if (bucket && Object.hasOwn(bucket, key)) {
      return bucket[key]
    }
    const wildcard = this.options[WILDCARD]
    if (wildcard && Object.hasOwn(wildcard, key)) {
      return wildcard[key]
    }
    return undefined
  },

  setOption(key: string, value: string, category = WILDCARD) {
    (this.options[category] ??= {})[key] = value
  },

  deleteOption(key: string, category = WILDCARD): boolean {
    let existed = false
    for (const bucketName of new Set([category, WILDCARD])) {
      const bucket = this.options[bucketName]
      if (bucket && Object.hasOwn(bucket, key)) {
        delete bucket[key]
        existed = true
      }
    }
    return existed
  },
}

function jsonResponse(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  }
}

/**
 * Emulates the Cumulocity Options REST API
 * (`/tenant/options/{category}[/{key}][/editable]`), matching the raw-fetch
 * implementation in `src/utils/tenantOptions.ts`.
 * @param url - Request path, e.g. `/tenant/options/<category>/<key>`
 * @param init - Request options
 * @param init.method - HTTP method (defaults to GET)
 * @param init.body - JSON request body
 */
async function fetchTenantOptions(url: string, init: { method?: string, body?: string } = {}) {
  const method = String(init.method ?? 'GET').toUpperCase()
  const [rawPath = ''] = String(url).split('?')
  const parts = rawPath.replace(/^\/+/, '').split('/').filter(Boolean)
  // Expected: ['tenant', 'options', <category>, <key?>, 'editable'?]
  const category = parts[2] !== undefined ? decodeURIComponent(parts[2]) : ''
  const key = parts[3] !== undefined ? decodeURIComponent(parts[3]) : undefined
  const isEditable = parts[4] === 'editable'

  let body: any
  try {
    body = init.body ? JSON.parse(init.body) : undefined
  } catch {
    body = undefined
  }

  if (isEditable && key !== undefined) {
    if (method === 'PUT') {
      c8yMock.editableFlags[`${category}::${key}`] = Boolean(body?.editable)
      return jsonResponse(200, { editable: Boolean(body?.editable) })
    }
    return jsonResponse(405)
  }

  if (key !== undefined) {
    if (method === 'GET') {
      const value = c8yMock.getOption(category, key)
      return value === undefined
        ? jsonResponse(404, { message: 'Not Found' })
        : jsonResponse(200, { category, key, value })
    }
    if (method === 'PUT') {
      c8yMock.setOption(key, body?.value, category)
      return jsonResponse(200, { category, key, value: body?.value })
    }
    if (method === 'DELETE') {
      return c8yMock.deleteOption(key, category)
        ? jsonResponse(204)
        : jsonResponse(404, { message: 'Not Found' })
    }
    return jsonResponse(405)
  }

  if (method === 'GET') {
    return jsonResponse(200, { ...c8yMock.options[category] })
  }
  if (method === 'PUT') {
    for (const [k, v] of Object.entries(body ?? {})) {
      c8yMock.setOption(k, v as string, category)
    }
    return jsonResponse(200, { ...c8yMock.options[category] })
  }
  return jsonResponse(405)
}

class BasicAuth {
  credentials: ICredentials
  constructor(credentials: ICredentials) {
    this.credentials = credentials
  }
}

class MicroserviceClientRequestAuth {
  headers: Record<string, string>
  constructor(headers: Record<string, string>) {
    this.headers = headers
  }
}

class Client {
  static getMicroserviceSubscriptions = async () => c8yMock.subscriptions.map((subscription) => ({ ...subscription }))

  core = {
    tenant: 't12345',
    defaultHeaders: {},
    fetch: fetchTenantOptions,
  }

  user = {
    currentWithEffectiveRoles: async () => c8yMock.currentUser
      ? { res: { ok: true, status: 200, statusText: 'OK' }, data: c8yMock.currentUser }
      : { res: { ok: false, status: 404, statusText: 'Not Found' }, data: null },
  }

  constructor(auth?: BasicAuth | MicroserviceClientRequestAuth, _baseUrl?: string) {
    if (auth instanceof BasicAuth && auth.credentials.tenant) {
      this.core.tenant = auth.credentials.tenant
    } else if (auth instanceof MicroserviceClientRequestAuth && auth.headers.authorization) {
      // Basic auth header: "tenant/user:password"
      try {
        const tenant = atob(auth.headers.authorization.replace('Basic ', '')).split('/')[0]
        if (tenant) {
          this.core.tenant = tenant
        }
      } catch {
        // ignore decode errors
      }
    }
  }
}

/**
 * Builds the `@c8y/client` mock module and seeds its state. c8y-nitro's runtime
 * only uses `Client`, `BasicAuth`, and `MicroserviceClientRequestAuth`, so the
 * real client is never loaded. Use it as a `vi.mock` factory at the top of a
 * server test file:
 *
 * ```ts
 * vi.mock('@c8y/client', async () => {
 *   const { mockC8yClientModule } = await import('./mocks/c8y-client')
 *   return mockC8yClientModule({ currentUser: { … } })
 * })
 * ```
 *
 * @param data - Initial mock backend state
 */
export function mockC8yClientModule(data: MockC8yClientData = {}) {
  c8yMock.seed(data)
  return { Client, BasicAuth, MicroserviceClientRequestAuth }
}
